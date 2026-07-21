// The 3D viewport. Renders every loaded PlacedObject as a gray-box proxy
// (ObjectBox.tsx) using the Unreal->three.js conversion in coords.ts.
//
// Notes for a Unity-background reader (CLAUDE.md §8):
// - <Canvas> is the WebGL surface — conceptually "Camera + render loop"
//   root, like a Unity scene's hierarchy under a root transform.
// - Every JSX element inside <Canvas> IS a three.js object instance (React
//   Three Fiber maps props to constructor args / properties); nesting
//   elements nests their transforms, same as parenting Transforms in Unity.
// - <OrbitControls> (drei) is the free-look/orbit rig — closest Unity
//   analogue is a SceneView-style camera controller.
// - <Grid> (drei) is a shader-drawn ground plane, purely a spatial
//   reference. It is NOT the real snap grid: per docs/CALIBRATION.md the
//   actual placement grid is 400cm, tilted per-base to an arbitrary yaw
//   inherited from whichever piece was placed first, and can differ between
//   disconnected clusters in the same base. Nothing here snaps to this
//   cosmetic grid; movement snapping (arrow keys) uses each selection's own
//   local axes instead — see useKeyboardControls.ts.
import { useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useEditorStore } from "../model/store";
import { ueVecToThree, yawFromQuat } from "./coords";
import { ObjectBox } from "./ObjectBox";
import { RadiusRing } from "./RadiusRing";
import { MarqueeSelect } from "./MarqueeSelect";
import { PlaceMode } from "./PlaceMode";
import { FlyCamera } from "./FlyCamera";
import { CameraDevHook } from "./CameraDevHook";
import { findPalbox } from "./campGeometry";
import { usePlaceModeStore } from "./placeModeStore";
import { computeStampFill, stampModeFromModifiers } from "./arrayStamp";
import { stampWithOverlapCheck } from "./overlapCheck";
import { useSelectionAnchorStore } from "./selectionAnchorStore";
import { computeRangeSelection } from "./selectionRange";

/** Labels get gnarly with a huge selection — cap concurrent 3D labels silently (sidebar still lists full selection info). */
const MAX_LABELS = 20;

export function Scene() {
  const objects = useEditorStore((s) => s.objects);
  const blueprint = useEditorStore((s) => s.blueprint);
  const camp = useEditorStore((s) => s.camp);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const placeObject = useEditorStore((s) => s.placeObject);
  const anchorId = useSelectionAnchorStore((s) => s.anchorId);
  const setAnchor = useSelectionAnchorStore((s) => s.setAnchor);

  // Recentre the whole base on the three.js origin (task brief: "compute the
  // centroid of all object positions and subtract it"). Deliberately keyed
  // on `blueprint` (a fresh object identity only on load), not on `objects`
  // — otherwise the entire scene would visibly re-center under the camera
  // every time you nudge a single object, which reads as broken rather than
  // as "recentring". `objects` at the moment `blueprint` changes is already
  // the freshly-loaded set (both are written in the same store update), so
  // this still captures the load-time centroid correctly.
  const centroidThree = useMemo(() => {
    if (objects.length === 0) return new THREE.Vector3();
    const sum = objects.reduce((acc, o) => acc.add(ueVecToThree(o.position)), new THREE.Vector3());
    return sum.multiplyScalar(1 / objects.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint]);

  const selectionSet = useMemo(() => new Set(selection), [selection]);
  // First N selected ids get a floating label in the 3D view — capped so a
  // huge multi-select doesn't paper the viewport in <Html> overlays.
  const labelIds = useMemo(() => new Set(selection.slice(0, MAX_LABELS)), [selection]);

  // Levels panel / visibility lens (src/ui/LevelsPanel.tsx, ./visibilityStore.ts):
  // every object's "level" is a whole floor count relative to the LIVE
  // palbox Z, same anchor RadiusGuardrail and PlaceMode.tsx's ghost-hint
  // already use. Computed once here and threaded down to ObjectBox/
  // MarqueeSelect rather than each looking up the palbox itself, so a
  // multi-thousand-object base doesn't redo an O(n) findPalbox scan per box.
  const palboxZ = useMemo(() => findPalbox(objects).palbox?.position.z ?? null, [objects]);

  // Click-selection semantics (CLAUDE.md task brief §1/§2 — "spreadsheet
  // semantics"). Precedence, highest first:
  //   Alt(+Shift)-click  -> select all objects of this typeId (replace, or
  //                         add to selection when Shift is also held). Never
  //                         reached while armed — ObjectBox.tsx's onClick
  //                         returns out of its placement branch before
  //                         calling onSelect at all, so "Alt = free-place"
  //                         and "Alt = select-all-of-type" can't collide.
  //   Shift-click        -> RANGE select: every object inside the 3D box
  //                         spanned by the anchor and this object (added to
  //                         the existing selection) — see selectionRange.ts.
  //                         Falls back to a plain single-select if there's
  //                         no live anchor (nothing clicked yet, or the
  //                         anchor object was since deleted/undone).
  //   Ctrl-click         -> toggle this object in/out of the selection (the
  //                         old shift-click behavior, moved here).
  //   plain click        -> replace selection with just this object.
  // Every branch ends by making the just-clicked object the new anchor, so
  // chained shift-clicks extend the range spreadsheet-style.
  const handleSelect = useCallback(
    (id: string, modifiers: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }) => {
      const clicked = objects.find((o) => o.id === id);
      if (!clicked) return;

      if (modifiers.altKey) {
        const sameType = objects.filter((o) => o.typeId === clicked.typeId).map((o) => o.id);
        setSelection(modifiers.shiftKey ? [...new Set([...selection, ...sameType])] : sameType);
        setAnchor(id);
        return;
      }

      if (modifiers.shiftKey) {
        const anchorObj = objects.find((o) => o.id === anchorId);
        if (!anchorObj) {
          setSelection([id]);
        } else {
          const rangeIds = computeRangeSelection(anchorObj, clicked, objects);
          setSelection([...new Set([...selection, ...rangeIds])]);
        }
        setAnchor(id);
        return;
      }

      if (modifiers.ctrlKey) {
        toggleSelect(id);
        setAnchor(id);
        return;
      }

      setSelection([id]);
      setAnchor(id);
    },
    [objects, selection, anchorId, toggleSelect, setSelection, setAnchor],
  );

  // onPointerMissed fires on any click that didn't hit an object — but a
  // native "click" also fires after an OrbitControls drag (mousedown and
  // mouseup both land on the same <canvas> element regardless of how far the
  // pointer travelled in between). Without this guard, every camera orbit
  // would silently clear the selection. Track the pointerdown position and
  // only treat it as an empty-space "click" if the pointer barely moved.
  //
  // Place mode (CLAUDE.md §6) piggybacks on this same guard: while armed, a
  // real click on empty space places the ghost's current position instead of
  // clearing selection, and — critically — does NOT disarm, so repeated
  // clicks stamp multiple pieces. See PlaceMode.tsx for the ghost/snap math
  // and ObjectBox.tsx for the other click path (clicking where an existing
  // object already is).
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 6;

  return (
    <Canvas
      // High top-down-ish default angle, looking roughly at the recentred
      // base origin (OrbitControls' default target is [0,0,0]).
      //
      // near/far explicit (fly-camera task): near 0.05 so flying up against
      // interior cladding clips cleanly instead of the near plane visibly
      // popping through geometry; far 5000 so a mega-base's full extent never
      // vanishes. Investigated the "apparent zoom cap on a large scene" from
      // an earlier session: neither OrbitControls nor this file ever set
      // maxDistance/far explicitly before, so both silently fell back to
      // three.js's OWN PerspectiveCamera constructor default of far=2000 (m,
      // since UNIT_SCALE=0.01 makes these units metres) — not an intentional
      // limit anywhere. OrbitControls itself has no distance cap (maxDistance
      // defaults to Infinity); dollying out past ~2000m just pushed the
      // camera beyond its own far plane, which clips (hides) everything and
      // reads exactly like a zoom cap even though the control itself never
      // stopped moving. 5000 gives real headroom over any base's radius.
      camera={{ position: [14, 16, 14], fov: 50, near: 0.05, far: 5000 }}
      // preserveDrawingBuffer: lets the gallery's Publish flow snapshot the
      // canvas for a thumbnail (PublishDialog.tsx captureThumbnail). Without
      // it, toBlob/drawImage reads back an empty buffer because WebGL clears
      // after each frame. Small memory cost, no measurable frame cost here.
      gl={{ preserveDrawingBuffer: true }}
      onPointerDown={(e) => {
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMissed={(e) => {
        const down = pointerDownPos.current;
        if (down) {
          const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
          if (dist > DRAG_THRESHOLD_PX) return; // was an orbit/pan drag, not a click
        }
        const { armedType, hover, setHover, lastStampPos, setLastStamp, setFeedback } = usePlaceModeStore.getState();
        if (armedType) {
          if (hover) {
            // Array stamping (task "B. Array stamping"): Shift = fill a
            // line from the last stamp to here, Ctrl+Shift = fill the
            // rectangle between them — see arrayStamp.ts. Plain click is
            // unchanged (single piece at the ghost's position). Each piece
            // in a fill is its own placeObject() call/undo step — documented
            // limitation, see the palette's armed-hint copy.
            const mode = stampModeFromModifiers(e.shiftKey, e.ctrlKey);
            const positions =
              mode === "single"
                ? [hover.position]
                : computeStampFill(lastStampPos, hover.position, yawFromQuat(hover.rotation), mode);
            // Overlap prevention (Fix 2): skip any position that already
            // holds a same-typeId object (see overlapCheck.ts). A blocked
            // single stamp gets a brief "already placed here" hint instead
            // of silently doing nothing; a fill/stack batch reports its
            // placed/skipped tally.
            const { objects: liveObjects } = useEditorStore.getState();
            const { placed, skipped } = stampWithOverlapCheck(liveObjects, armedType, positions, hover.rotation, placeObject);
            if (mode === "single") {
              if (placed === 0) setFeedback("already placed here");
            } else {
              setFeedback(`placed ${placed}, skipped ${skipped} overlapping`);
            }
            // The clicked cell is still a sensible anchor for the NEXT fill
            // even when this stamp itself was skipped as a duplicate (the
            // piece is already there, same as if this click had placed it).
            setLastStamp(hover.position, hover.rotation);
            if (placed > 0) {
              // Hide the ghost until the next pointer move: the store
              // auto-selects the just-placed object (highlighted, opaque),
              // and without this the translucent ghost would sit exactly on
              // top of it for one frame — a real "fighting" visual, not just
              // theoretical (see task brief §4). Skipped entirely when
              // nothing was actually placed (fully-blocked stamp) so the
              // ghost stays visible at the blocked spot.
              setHover(null);
            }
          }
          return; // stays armed — repeated clicks stamp multiple pieces
        }
        clearSelection();
        setAnchor(null); // spreadsheet-style range anchor resets whenever selection is cleared
      }}
    >
      {/* Lower ambient / raking directional angle (piece-boundary fix,
          optional half): flat-shaded facets pick up more contrast from a
          more grazing key light than the near-overhead 10/20/10 default —
          cheap complement to the edge-overlay above, not a substitute for
          it (edges still carry the "where does this piece end" legibility
          on facets that face the light dead-on). */}
      <ambientLight intensity={0.65} />
      <directionalLight position={[18, 22, -9]} intensity={0.85} />

      <Grid
        args={[100, 100]}
        cellSize={1}
        cellThickness={0.5}
        sectionSize={10}
        sectionThickness={1}
        fadeDistance={200}
        infiniteGrid
      />

      <RadiusRing objects={objects} camp={camp} centroidThree={centroidThree} />

      {objects.map((o) => (
        <ObjectBox
          key={o.id}
          object={o}
          centroidThree={centroidThree}
          selected={selectionSet.has(o.id)}
          showLabel={labelIds.has(o.id)}
          onSelect={handleSelect}
          palboxZ={palboxZ}
        />
      ))}

      {/* Shift+drag box-select on empty space — see MarqueeSelect.tsx header
          for why this can't interfere with plain-drag orbit or click-select.
          Rendered before OrbitControls so its pointerdown listener attaches
          first (belt-and-suspenders; the enabled-flag trick doesn't
          strictly depend on this ordering, see that file). */}
      <MarqueeSelect objects={objects} centroidThree={centroidThree} palboxZ={palboxZ} />

      {/* Phase 2 place-mode ghost preview (CLAUDE.md §6) — renders nothing
          while nothing is armed. The actual placement click is handled above
          (onPointerMissed) and in ObjectBox.tsx, not here — see PlaceMode.tsx
          header. */}
      <PlaceMode objects={objects} centroidThree={centroidThree} />

      {/* Unity-SceneView-style RMB flythrough (task brief) — disables
          OrbitControls for the duration of the hold and hands it back a
          sensible target on release. See FlyCamera.tsx header for the full
          interaction model and why WASD/Q/E are safe to hand it exclusively
          while flying (useKeyboardControls.ts defers via flyCameraState.ts). */}
      <FlyCamera />

      <OrbitControls makeDefault />

      {/* DEV-ONLY: exposes camera/controls on window for the screenshot
          pipeline that records feature GIFs. Tree-shaken from prod builds. */}
      {import.meta.env.DEV && <CameraDevHook />}
    </Canvas>
  );
}
