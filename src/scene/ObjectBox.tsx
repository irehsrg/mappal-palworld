// One placed object, rendered as a gray-box proxy (CLAUDE.md §5 — we never
// have real meshes, C2). A "box" here is a single three.js Mesh + BoxGeometry
// whose size/position/rotation are all derived from the editor model; there
// is no per-typeId prefab, just data-driven dimensions from objectTypes.ts.
import { useMemo } from "react";
import * as THREE from "three";
import { Html, Outlines } from "@react-three/drei";
import type { PlacedObject } from "../model/types";
import { useEditorStore } from "../model/store";
import { ueVecToThree, ueQuatToThree, ueSizeToThreeBoxArgs } from "./coords";
import { getTypeEntry, resolveType } from "./objectTypes";
import { usePlaceModeStore } from "./placeModeStore";

export interface ObjectBoxProps {
  object: PlacedObject;
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
  selected: boolean;
  /** Show the floating display-name label above this box (Scene.tsx caps this at 20 concurrent labels). */
  showLabel: boolean;
  onSelect: (id: string, additive: boolean) => void;
}

export function ObjectBox({ object, centroidThree, selected, showLabel, onSelect }: ObjectBoxProps) {
  const resolved = resolveType(object.typeId);
  const isWorldObject = resolved.category === "world" && !resolved.isUnknownDims;
  const displayName = getTypeEntry(object.typeId)?.name ?? object.typeId;

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
        // Place mode (CLAUDE.md §6): clicking on top of an existing object
        // while armed still places the new piece at the ghost's ground
        // position — it must never select the object underneath instead.
        // See PlaceMode.tsx / Scene.tsx's onPointerMissed for the other half
        // of this (clicking empty space while armed).
        const { armedType, hover, setHover } = usePlaceModeStore.getState();
        if (armedType) {
          if (hover) {
            useEditorStore.getState().placeObject(armedType, hover.position, hover.rotation);
            // See Scene.tsx's onPointerMissed for why the ghost is hidden
            // immediately after a placement click (auto-select vs. ghost
            // overlap on the same frame).
            setHover(null);
          }
          return;
        }
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

      {/* Floating display-name label, billboarded (screen-space) by drei's
          Html — `center` anchors it at this point instead of top-left, and
          `pointerEvents="none"` keeps it from stealing clicks meant for the
          box underneath. Position is in the mesh's local space, so this
          floats just above the box regardless of the box's own rotation. */}
      {showLabel && (
        <Html center pointerEvents="none" position={[0, boxArgs[1] / 2 + 0.2, 0]} style={{ zIndex: 1 }}>
          <div className="object-label">{displayName}</div>
        </Html>
      )}
    </mesh>
  );
}
