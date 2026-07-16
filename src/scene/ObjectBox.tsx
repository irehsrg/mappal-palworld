// One placed object, rendered as a gray-box-turned-parametric-shape proxy
// (CLAUDE.md §5 — we never have real meshes, C2: procedural three.js
// geometry only, nothing ripped from game assets). The shape itself comes
// from proxyGeometry.ts, keyed off the typeId's name; there is still no
// per-typeId prefab in the "real mesh" sense — just a data-driven silhouette
// derived from objectTypes.ts's dimensions.
import { useMemo } from "react";
import * as THREE from "three";
import { Html, Outlines } from "@react-three/drei";
import type { PlacedObject } from "../model/types";
import { useEditorStore } from "../model/store";
import { ueVecToThree, ueQuatToThree, yawFromQuat } from "./coords";
import { getTypeEntry, resolveType } from "./objectTypes";
import { getProxyGeometry } from "./proxyGeometry";
import { usePlaceModeStore } from "./placeModeStore";
import { computeStampFill, stampModeFromModifiers } from "./arrayStamp";

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
  const { position, quaternion } = useMemo(() => {
    // No vertical origin offset needed here anymore (contrast with the old
    // "centered box + half-height offset" trick): proxyGeometry.ts builds
    // every shape already anchored per objects.json's `originAtTop`
    // convention (top-anchored foundations extend down from local Y=0,
    // everything else extends up from local Y=0), so the mesh sits directly
    // at the object's own Z. Rotation here is always pure yaw
    // (docs/CALIBRATION.md), so it never tilts the vertical axis.
    const posUE = { x: object.position.x, y: object.position.y, z: object.position.z };
    return {
      position: ueVecToThree(posUE).sub(centroidThree),
      quaternion: ueQuatToThree(object.rotation),
    };
  }, [object.position.x, object.position.y, object.position.z, object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.w, centroidThree]);

  // Shared with PlaceMode.tsx's ghost preview so the armed-item preview and
  // the placed object always render the exact same silhouette. Geometries
  // are memoized inside proxyGeometry.ts (shared across every instance of
  // the same shape+size), so this lookup is cheap — a Map hit, not a build.
  const geometry = useMemo(
    () => getProxyGeometry(object.typeId, resolved.size, resolved.originAtTop, resolved.isUnknownDims),
    [object.typeId, resolved.size, resolved.originAtTop, resolved.isUnknownDims],
  );
  // Label floats just above the shape's local top. Bottom-anchored shapes
  // span local Y [0,height] (top = height); top-anchored (foundation) shapes
  // span [-height,0] (top = 0) — geometry.boundingBox.max.y covers both.
  // Guarded (not recomputed if already set) since geometry is shared across
  // every instance of the same shape+size — see proxyGeometry.ts's cache.
  const labelY = useMemo(() => {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    return (geometry.boundingBox?.max.y ?? 0) + 0.2;
  }, [geometry]);

  const glassOpacity = resolved.materialOpacity;
  const transparent = isWorldObject || glassOpacity !== undefined;
  const opacity = glassOpacity ?? (isWorldObject ? 0.55 : 1);

  return (
    <mesh
      position={position}
      quaternion={quaternion}
      geometry={geometry}
      onClick={(e) => {
        // Stop propagation so this doesn't also trigger the Canvas's
        // onPointerMissed (which clears selection on empty-space clicks).
        e.stopPropagation();
        // Place mode (CLAUDE.md §6): clicking on top of an existing object
        // while armed still places the new piece at the ghost's ground
        // position — it must never select the object underneath instead.
        // See PlaceMode.tsx / Scene.tsx's onPointerMissed for the other half
        // of this (clicking empty space while armed).
        const { armedType, hover, setHover, lastStampPos, setLastStampPos } = usePlaceModeStore.getState();
        if (armedType) {
          if (hover) {
            // Array stamping (task "B. Array stamping") — same Shift/
            // Ctrl+Shift line/rect fill as Scene.tsx's onPointerMissed (this
            // is the "clicked on top of an existing object while armed"
            // path); see arrayStamp.ts and that file's comment for details.
            const mode = stampModeFromModifiers(e.shiftKey, e.ctrlKey);
            const positions =
              mode === "single"
                ? [hover.position]
                : computeStampFill(lastStampPos, hover.position, yawFromQuat(hover.rotation), mode);
            for (const pos of positions) useEditorStore.getState().placeObject(armedType, pos, hover.rotation);
            setLastStampPos(hover.position);
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
      <meshStandardMaterial
        color={resolved.color}
        transparent={transparent}
        opacity={opacity}
        side={THREE.DoubleSide}
        flatShading
        emissive={selected ? "#ffffff" : "#000000"}
        emissiveIntensity={selected ? 0.45 : 0}
      />
      {/* drei Outlines draws a screen-space outline mesh around this shape's
          geometry — the "Unity SelectionOutline" equivalent — without us
          hand-rolling a second scaled-up mesh. Works on arbitrary
          BufferGeometry (including the merged stair/fence/ladder shapes);
          the emissive highlight above is the fallback if it ever doesn't. */}
      {selected && <Outlines thickness={2} color="#5be3ff" />}

      {/* Floating display-name label, billboarded (screen-space) by drei's
          Html — `center` anchors it at this point instead of top-left, and
          `pointerEvents="none"` keeps it from stealing clicks meant for the
          shape underneath. Position is in the mesh's local space, so this
          floats just above the shape regardless of the mesh's own rotation. */}
      {showLabel && (
        <Html center pointerEvents="none" position={[0, labelY, 0]} style={{ zIndex: 1 }}>
          <div className="object-label">{displayName}</div>
        </Html>
      )}
    </mesh>
  );
}
