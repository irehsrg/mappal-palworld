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
import { Outlines } from "@react-three/drei";
import type { PlacedObject, Quat, Vec3 } from "../model/types";
import { GRID_PITCH } from "../model/types";
import { usePlaceModeStore } from "./placeModeStore";
import { findPalbox } from "./campGeometry";
import { resolveType } from "./objectTypes";
import {
  UNIT_SCALE,
  localAxesFromYaw,
  threeVecToUe,
  ueQuatToThree,
  ueSizeToThreeBoxArgs,
  ueVecToThree,
  yawFromQuat,
} from "./coords";

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
      const { palbox } = findPalbox(objectsRef.current);
      // Ground plane height + snap-grid anchor/yaw/rotation all come from the
      // palbox (task brief: "derive yaw from the palbox object's rotation",
      // "place with rotation = the palbox's rotation quaternion", "Placement
      // z = palbox z"). No palbox → world origin/identity, so placement still
      // works (just unsnapped-to-any-base) rather than being unusable.
      const anchorUE: Vec3 = palbox ? palbox.position : WORLD_ANCHOR;
      const rotation: Quat = palbox ? palbox.rotation : IDENTITY_QUAT;
      const yaw = palbox ? yawFromQuat(palbox.rotation) : 0;

      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      // Ground plane in the scene's recentred three.js space: UE z=anchorUE.z
      // converted to three-Y, minus the same centroid offset every rendered
      // object is placed with (Scene.tsx / ObjectBox.tsx).
      const planeHeightThree = anchorUE.z * UNIT_SCALE - centroidRef.current.y;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeightThree);

      const hit = raycaster.ray.intersectPlane(plane, hitThree);
      if (!hit) {
        usePlaceModeStore.getState().setHover(null);
        return;
      }

      const hitUE = threeVecToUe(hitThree.clone().add(centroidRef.current));

      let x = hitUE.x;
      let y = hitUE.y;
      if (!e.altKey) {
        // Snap to the base's own grid (task brief): project the hit point
        // onto the palbox's local forward/right axes, round each component
        // to the nearest GRID_PITCH, reproject. Same rotated-frame technique
        // as ArrowKey nudging in useKeyboardControls.ts, just anchored at the
        // palbox instead of at the moving object's own prior position.
        const { forward, right } = localAxesFromYaw(yaw);
        const relX = hitUE.x - anchorUE.x;
        const relY = hitUE.y - anchorUE.y;
        const rf = Math.round((relX * forward.x + relY * forward.y) / GRID_PITCH) * GRID_PITCH;
        const rr = Math.round((relX * right.x + relY * right.y) / GRID_PITCH) * GRID_PITCH;
        x = anchorUE.x + forward.x * rf + right.x * rr;
        y = anchorUE.y + forward.y * rf + right.y * rr;
      }

      usePlaceModeStore.getState().setHover({
        position: { x, y, z: anchorUE.z },
        rotation,
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

  // Ghost box: same size/color/vertical-origin convention as ObjectBox.tsx,
  // just translucent and non-interactive (raycast disabled — RadiusRing.tsx
  // uses the same trick — so it never steals the click meant to place/select
  // at this same screen position).
  const resolved = resolveType(armedType);
  const halfHeightUE = resolved.size[2] / 2;
  const zOffsetUE = resolved.originAtTop ? -halfHeightUE : halfHeightUE;
  const posUE: Vec3 = { x: hover.position.x, y: hover.position.y, z: hover.position.z + zOffsetUE };
  const position = ueVecToThree(posUE).sub(centroidThree);
  const quaternion = ueQuatToThree(hover.rotation);
  const boxArgs = ueSizeToThreeBoxArgs(resolved.size);

  return (
    <mesh position={position} quaternion={quaternion} raycast={() => null}>
      <boxGeometry args={boxArgs} />
      <meshStandardMaterial color={resolved.color} transparent opacity={0.4} depthWrite={false} />
      <Outlines thickness={1.5} color="#5be3ff" />
    </mesh>
  );
}
