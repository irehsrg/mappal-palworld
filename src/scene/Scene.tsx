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
import { ueVecToThree } from "./coords";
import { ObjectBox } from "./ObjectBox";
import { RadiusRing } from "./RadiusRing";
import { MarqueeSelect } from "./MarqueeSelect";

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

  const handleSelect = useCallback(
    (id: string, additive: boolean) => {
      if (additive) toggleSelect(id);
      else setSelection([id]);
    },
    [toggleSelect, setSelection],
  );

  // onPointerMissed fires on any click that didn't hit an object — but a
  // native "click" also fires after an OrbitControls drag (mousedown and
  // mouseup both land on the same <canvas> element regardless of how far the
  // pointer travelled in between). Without this guard, every camera orbit
  // would silently clear the selection. Track the pointerdown position and
  // only treat it as an empty-space "click" if the pointer barely moved.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 6;

  return (
    <Canvas
      // High top-down-ish default angle, looking roughly at the recentred
      // base origin (OrbitControls' default target is [0,0,0]).
      camera={{ position: [14, 16, 14], fov: 50 }}
      onPointerDown={(e) => {
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMissed={(e) => {
        const down = pointerDownPos.current;
        if (down) {
          const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
          if (dist > DRAG_THRESHOLD_PX) return; // was an orbit/pan drag, not a click
        }
        clearSelection();
      }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 20, 10]} intensity={0.6} />

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
        />
      ))}

      {/* Shift+drag box-select on empty space — see MarqueeSelect.tsx header
          for why this can't interfere with plain-drag orbit or click-select.
          Rendered before OrbitControls so its pointerdown listener attaches
          first (belt-and-suspenders; the enabled-flag trick doesn't
          strictly depend on this ordering, see that file). */}
      <MarqueeSelect objects={objects} centroidThree={centroidThree} />

      <OrbitControls makeDefault />
    </Canvas>
  );
}
