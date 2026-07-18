// Phase 2 "place new object" interaction (CLAUDE.md §6): the ghost preview
// and its raycast/snap math. Rendered inside <Canvas> (Scene.tsx) whenever
// something is armed via the palette (src/ui/Palette.tsx).
//
// This component does NOT handle the actual placement click — that's owned
// by Scene.tsx's onPointerMissed and ObjectBox.tsx's onClick, so armed mode
// can hijack "click on empty space" and "click on an existing object" alike
// without this component needing a full-viewport invisible hit-test plane of
// its own. Those two call sites just read `usePlaceModeStore.getState()` at
// click time and use whatever `hover` this component last computed — see
// placeModeStore.ts's header for the full list of consumers.
//
// Raycasting is done with a native `pointermove` listener on the canvas DOM
// element (same technique as MarqueeSelect.tsx) rather than R3F's per-mesh
// pointer events, for two reasons: (1) the ghost must track the pointer even
// when the pointer isn't over any existing mesh — a plain ground hit — and
// (2) the native PointerEvent gives us `e.altKey` directly for the
// free-placement modifier, no separate key-tracking needed.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html, Outlines } from "@react-three/drei";
import type { PlacedObject, Quat, Vec3 } from "../model/types";
import { GRID_PITCH } from "../model/types";
import { usePlaceModeStore } from "./placeModeStore";
import { findPalbox } from "./campGeometry";
import { getTypeEntry, resolveType } from "./objectTypes";
import { getProxyGeometry } from "./proxyGeometry";
import { UNIT_SCALE, localAxesFromYaw, threeVecToUe, ueQuatToThree, ueVecToThree, yawFromQuat } from "./coords";
import { computeStampFill, stampFillNewCount, stampModeFromModifiers } from "./arrayStamp";

export interface PlaceModeProps {
  objects: PlacedObject[];
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
}

/** No palbox in this file: fall back to world origin/identity rotation as the "base grid" anchor — see file header and CLAUDE.md §6 (donor placement still works without a palbox, it just can't inherit a base's yaw). */
const WORLD_ANCHOR: Vec3 = { x: 0, y: 0, z: 0 };
const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function PlaceMode({ objects, centroidThree }: PlaceModeProps) {
  const { camera, gl } = useThree();
  const armedType = usePlaceModeStore((s) => s.armedType);
  const hover = usePlaceModeStore((s) => s.hover);

  // Read via refs inside the native listener (same technique as
  // MarqueeSelect.tsx) so a moving palbox / edited object list is always
  // seen by the very next pointermove without needing to reattach the
  // listener on every store update.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const centroidRef = useRef(centroidThree);
  centroidRef.current = centroidThree;
  // Seeds the ground-plane height for the FIRST raycast pass each pointer
  // move (see onPointerMove below) — without a decent guess we'd have to
  // raycast against some arbitrary plane before we even know which anchor
  // is active. Persists frame-to-frame (not reset on re-arm) since "last
  // known anchor Z" is still a reasonable guess for the next frame even
  // across a re-arm; it self-corrects within one pointermove regardless.
  const lastAnchorZRef = useRef<number | null>(null);

  // Effect re-attaches whenever armed state flips so we can cleanly clear the
  // hover on disarm (and skip listening entirely while nothing is armed).
  useEffect(() => {
    if (!armedType) {
      usePlaceModeStore.getState().setHover(null);
      return;
    }

    const dom = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitThree = new THREE.Vector3();

    function onPointerMove(e: PointerEvent) {
      // Named distinctly from the component's own `objects` prop (which this
      // closure must NOT read — see the refs comment above) to avoid any
      // accidental shadowing confusion.
      const liveObjects = objectsRef.current;
      const { palbox } = findPalbox(liveObjects);
      // Palbox-frame fallback (used when no other structure is in range, or
      // when there's no palbox at all — world origin/identity, so placement
      // still works, just unsnapped-to-any-base, rather than being unusable).
      const palboxAnchorUE: Vec3 = palbox ? palbox.position : WORLD_ANCHOR;
      const palboxRotation: Quat = palbox ? palbox.rotation : IDENTITY_QUAT;

      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      // Raycast the pointer against a horizontal plane at a given UE z,
      // returning the hit in UE space (or null if the ray is parallel to
      // the plane, e.g. camera looking at the horizon). Ground plane is in
      // the scene's recentred three.js space: UE z converted to three-Y,
      // minus the same centroid offset every rendered object is placed with
      // (Scene.tsx / ObjectBox.tsx).
      function raycastAtZ(zUE: number): Vec3 | null {
        const planeHeightThree = zUE * UNIT_SCALE - centroidRef.current.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeightThree);
        const hit = raycaster.ray.intersectPlane(plane, hitThree);
        if (!hit) return null;
        return threeVecToUe(hitThree.clone().add(centroidRef.current));
      }

      // Pass 1: raycast at our best guess of the active anchor's Z (last
      // frame's anchor, or the palbox as a first-ever guess) just to get an
      // approximate XY — good enough to search for a nearby structure below.
      // This resolves the chicken-and-egg problem of "which anchor sets the
      // plane height" vs "the anchor search needs a hit point": a stacked
      // foundation one floor up will correct itself in pass 2 (below) once
      // we know it's the active anchor, so being one floor off for the
      // search itself doesn't matter — horizontal distance is all pass 1 needs.
      const approxHitUE = raycastAtZ(lastAnchorZRef.current ?? palboxAnchorUE.z);
      if (!approxHitUE) {
        usePlaceModeStore.getState().setHover(null);
        return;
      }

      // Nearest-structure snapping (task "1."): the nearest "structure"
      // category object within 1200 UE units (horizontal) of the approx hit
      // becomes the active anchor — its position/yaw/z define the local grid
      // this placement snaps to, not just the palbox's. Palbox is itself
      // category "structure" (objects.json), so when it's the nearest thing
      // in range this naturally reduces to the old palbox-only behavior;
      // the explicit palboxAnchorUE fallback below only fires when NOTHING
      // (not even the palbox) is within range.
      const SNAP_SEARCH_RADIUS = 1200;
      let nearest: PlacedObject | null = null;
      let nearestDist = Infinity;
      for (const o of liveObjects) {
        if (resolveType(o.typeId).category !== "structure") continue;
        const d = Math.hypot(o.position.x - approxHitUE.x, o.position.y - approxHitUE.y);
        if (d <= SNAP_SEARCH_RADIUS && d < nearestDist) {
          nearest = o;
          nearestDist = d;
        }
      }

      const anchorUE: Vec3 = nearest ? nearest.position : palboxAnchorUE;
      const rotation: Quat = nearest ? nearest.rotation : palboxRotation;
      const yaw = yawFromQuat(rotation);
      lastAnchorZRef.current = anchorUE.z;

      // Pass 2: if the active anchor sits on a different floor than our pass-1
      // guess, redo the raycast against ITS z plane so the ghost tracks the
      // correct floor (e.g. hovering near a foundation stacked one level up).
      let hitUE = approxHitUE;
      if (Math.abs(anchorUE.z - approxHitUE.z) > 1e-6) {
        const reHit = raycastAtZ(anchorUE.z);
        if (reHit) hitUE = reHit;
      }

      // Cursor hint (task "1.": "Show the active anchor in the cursor hint").
      // Alt overrides the label to "free" even though z above still tracks
      // the active anchor — see the free-placement comment below for why.
      const anchorLabel = e.altKey
        ? "free"
        : nearest
          ? `snap: ${getTypeEntry(nearest.typeId)?.name ?? nearest.typeId}`
          : palbox
            ? "snap: palbox grid"
            : "snap: world grid";

      let x = hitUE.x;
      let y = hitUE.y;
      if (!e.altKey) {
        // Snap to the active anchor's own grid (task brief): project the hit
        // point onto its local forward/right axes, round each component to
        // the nearest GRID_PITCH, reproject. Same rotated-frame technique as
        // ArrowKey nudging in useKeyboardControls.ts, just anchored at the
        // active anchor instead of at the moving object's own prior position.
        const { forward, right } = localAxesFromYaw(yaw);
        const relX = hitUE.x - anchorUE.x;
        const relY = hitUE.y - anchorUE.y;
        const rf = Math.round((relX * forward.x + relY * forward.y) / GRID_PITCH) * GRID_PITCH;
        const rr = Math.round((relX * right.x + relY * right.y) / GRID_PITCH) * GRID_PITCH;
        x = anchorUE.x + forward.x * rf + right.x * rr;
        y = anchorUE.y + forward.y * rf + right.y * rr;
      }
      // Alt (free placement): x/y are the raw hit point, unsnapped. z is
      // still taken from the active anchor (nearest in-range structure, or
      // the palbox) rather than always the palbox — DECISION: this keeps the
      // ghost glued to whichever floor you're hovering near even with Alt
      // held, instead of jumping back to the palbox's floor, which reads as
      // a bug ("why did my free-placed piece end up on the wrong level")
      // more than a feature. Documented per task brief ("pick and document").

      const targetPos: Vec3 = { x, y, z: anchorUE.z };

      // Array-stamp preview (task "B. Array stamping"): only while
      // Shift/Ctrl+Shift is held and a prior stamp exists this session to
      // fill from — see arrayStamp.ts for the line/rect math, shared with
      // the actual placement click in Scene.tsx / ObjectBox.tsx.
      const { lastStampPos } = usePlaceModeStore.getState();
      const stampMode = stampModeFromModifiers(e.shiftKey, e.ctrlKey);
      let fillPositions: Vec3[] | undefined;
      let fillCountFull: number | undefined;
      if (stampMode !== "single" && lastStampPos) {
        fillPositions = computeStampFill(lastStampPos, targetPos, yaw, stampMode);
        fillCountFull = stampFillNewCount(lastStampPos, targetPos, yaw, stampMode);
      }

      usePlaceModeStore.getState().setHover({
        position: targetPos,
        rotation,
        anchorLabel,
        fillPositions,
        fillCountFull,
      });
    }

    function onPointerLeave() {
      usePlaceModeStore.getState().setHover(null);
    }

    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerleave", onPointerLeave);
    return () => {
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerleave", onPointerLeave);
      usePlaceModeStore.getState().setHover(null);
    };
    // objects/centroidThree deliberately excluded: the listener reads them
    // via the refs above (kept fresh every render), not this closure, so the
    // listener doesn't need to be torn down and reattached on every object
    // edit — only when arming flips or the render target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedType, camera, gl]);

  if (!armedType || !hover) return null;

  // Ghost shape: same geometry (proxyGeometry.ts, shared with ObjectBox.tsx
  // — the brief requires the ghost preview to use the identical geometry,
  // not a lookalike) and same vertical-origin convention, just translucent
  // and non-interactive (raycast disabled — RadiusRing.tsx uses the same
  // trick — so it never steals the click meant to place/select at this same
  // screen position). No zOffset needed: proxyGeometry.ts's shapes are
  // already anchored per originAtTop, so each mesh sits directly at its
  // position.z. Geometry/quaternion are identical for every ghost in a fill
  // (same armed type, same anchor rotation), so they're built once and
  // reused across every rendered ghost — cheap even at the 200-piece cap.
  const resolved = resolveType(armedType);
  const quaternion = ueQuatToThree(hover.rotation);
  const geometry = getProxyGeometry(armedType, resolved.size, resolved.originAtTop, resolved.isUnknownDims);

  // Array-stamp preview (task "B. Array stamping"): when a Shift/Ctrl+Shift
  // fill is in progress, hover.fillPositions is the authoritative list of
  // NEW cells a click would stamp (may be empty — hovering exactly back on
  // the anchor cell means "nothing new to place here"). Otherwise fall back
  // to the single cursor ghost, same as before array stamping existed.
  const ghostPositions: Vec3[] = hover.fillPositions ?? [hover.position];
  const showBadge = hover.fillPositions !== undefined && hover.fillPositions.length > 0;

  return (
    <>
      {ghostPositions.map((posUE, i) => (
        <mesh
          key={i}
          position={ueVecToThree(posUE).sub(centroidThree)}
          quaternion={quaternion}
          geometry={geometry}
          raycast={() => null}
        >
          <meshStandardMaterial
            color={resolved.color}
            transparent
            opacity={resolved.materialOpacity ?? 0.4}
            depthWrite={false}
            side={THREE.DoubleSide}
            flatShading
          />
          <Outlines thickness={1.5} color="#5be3ff" />
        </mesh>
      ))}
      {/* Active-anchor hint (task "1.": always visible while placing, so the
          user always knows which grid a click will snap to). Sits just above
          the ghost; the fill-count badge (below) sits above THIS when both
          are showing, so they never overlap. */}
      <Html
        position={ueVecToThree(hover.position).sub(centroidThree)}
        center
        pointerEvents="none"
        style={{ transform: "translateY(-28px)" }}
      >
        <div className="place-anchor-hint">{hover.anchorLabel}</div>
      </Html>
      {showBadge && (
        <Html
          position={ueVecToThree(hover.position).sub(centroidThree)}
          center
          pointerEvents="none"
          style={{ transform: "translateY(-46px)" }}
        >
          <div className="place-fill-badge">
            {hover.fillPositions!.length}
            {hover.fillCountFull !== undefined && hover.fillCountFull > hover.fillPositions!.length
              ? ` of ${hover.fillCountFull} (capped)`
              : ""}
          </div>
        </Html>
      )}
    </>
  );
}
