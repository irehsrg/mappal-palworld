// Translucent disc + ring on the ground plane showing the base's build
// radius (camp.areaRange), centered on the LIVE palbox position (not
// camp.position — see campGeometry.ts header for why). Purely cosmetic,
// exactly like the Grid in Scene.tsx — CLAUDE.md §5 says no terrain/ground
// rendering, but a reference circle for the guardrail is not terrain, it's
// the same kind of non-diegetic aid as the Grid.
import { useMemo } from "react";
import * as THREE from "three";
import type { CampInfo } from "../model/blueprintView";
import type { PlacedObject } from "../model/types";
import { ueVecToThree, UNIT_SCALE } from "./coords";
import { findPalbox } from "./campGeometry";
import { effectiveRadius, useRadiusStore } from "./radiusStore";

export interface RadiusRingProps {
  objects: PlacedObject[];
  camp: CampInfo | null;
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
}

export function RadiusRing({ objects, camp, centroidThree }: RadiusRingProps) {
  const { palbox } = findPalbox(objects);
  const multiplier = useRadiusStore((s) => s.multiplier);

  const center = useMemo(() => {
    if (!palbox) return null;
    return ueVecToThree(palbox.position).sub(centroidThree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palbox?.position.x, palbox?.position.y, palbox?.position.z, centroidThree]);

  if (!camp || !palbox || !center) return null;

  // Modded-radius users scale this up (see radiusStore.ts). When they do, the
  // vanilla circle is still drawn as a fainter inner ring so it stays obvious
  // where the unmodded limit sits.
  const radius = effectiveRadius(camp.areaRange, multiplier) * UNIT_SCALE;
  const vanillaRadius = camp.areaRange * UNIT_SCALE;
  const showVanilla = multiplier > 1;

  return (
    // Lie flat on the ground plane (three.js XZ): rotate the disc's default
    // XY-facing normal (+Z) down to +Y (up). Sits a hair below the palbox's
    // own base height to avoid z-fighting with any object resting on it.
    <group position={[center.x, center.y - 0.02, center.z]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* raycast disabled on both meshes so this never steals clicks that
          should clear/change selection or hit an object underneath it. */}
      <mesh raycast={() => null}>
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial color="#5be3ff" transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh raycast={() => null}>
        <ringGeometry args={[radius * 0.985, radius, 64]} />
        <meshBasicMaterial color="#5be3ff" transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {showVanilla && (
        <mesh raycast={() => null}>
          <ringGeometry args={[vanillaRadius * 0.99, vanillaRadius, 64]} />
          <meshBasicMaterial color="#5be3ff" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
