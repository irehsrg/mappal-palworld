// One placed object, rendered as a gray-box proxy (CLAUDE.md §5 — we never
// have real meshes, C2). A "box" here is a single three.js Mesh + BoxGeometry
// whose size/position/rotation are all derived from the editor model; there
// is no per-typeId prefab, just data-driven dimensions from objectTypes.ts.
import { useMemo } from "react";
import * as THREE from "three";
import { Outlines } from "@react-three/drei";
import type { PlacedObject } from "../model/types";
import { ueVecToThree, ueQuatToThree, ueSizeToThreeBoxArgs } from "./coords";
import { resolveType } from "./objectTypes";

export interface ObjectBoxProps {
  object: PlacedObject;
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}

export function ObjectBox({ object, centroidThree, selected, onSelect }: ObjectBoxProps) {
  const resolved = resolveType(object.typeId);
  const isWorldObject = resolved.category === "world" && !resolved.isUnknownDims;

  // Position + rotation are recomputed only when the object's own transform
  // (or the scene recentring offset) changes — cheap, but no need to redo it
  // every render of an unrelated sibling.
  const { position, quaternion, boxArgs } = useMemo(() => {
    // Vertical origin convention (CLAUDE.md §5 / objects.json `originAtTop`):
    // foundations store their TOP surface and extend downward; everything
    // else stores its BOTTOM and extends upward. Rotation here is always
    // pure yaw (docs/CALIBRATION.md), so it never tilts the vertical axis —
    // the offset can be applied directly in Unreal Z before conversion.
    const halfHeightUE = resolved.size[2] / 2;
    const zOffsetUE = resolved.originAtTop ? -halfHeightUE : halfHeightUE;
    const posUE = {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z + zOffsetUE,
    };
    return {
      position: ueVecToThree(posUE).sub(centroidThree),
      quaternion: ueQuatToThree(object.rotation),
      boxArgs: ueSizeToThreeBoxArgs(resolved.size),
    };
  }, [
    object.position.x,
    object.position.y,
    object.position.z,
    object.rotation.x,
    object.rotation.y,
    object.rotation.z,
    object.rotation.w,
    centroidThree,
    resolved.size,
    resolved.originAtTop,
  ]);

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      onClick={(e) => {
        // Stop propagation so this doesn't also trigger the Canvas's
        // onPointerMissed (which clears selection on empty-space clicks).
        e.stopPropagation();
        onSelect(object.id, e.shiftKey);
      }}
    >
      <boxGeometry args={boxArgs} />
      <meshStandardMaterial
        color={resolved.color}
        transparent={isWorldObject}
        opacity={isWorldObject ? 0.55 : 1}
        emissive={selected ? "#ffffff" : "#000000"}
        emissiveIntensity={selected ? 0.45 : 0}
      />
      {/* drei Outlines draws a screen-space outline mesh around this box's
          geometry — the "Unity SelectionOutline" equivalent — without us
          hand-rolling a second scaled-up mesh. */}
      {selected && <Outlines thickness={2} color="#5be3ff" />}
    </mesh>
  );
}
