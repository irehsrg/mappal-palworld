// Spreadsheet-style range select (CLAUDE.md task brief §1). Given an
// "anchor" object (the most recent plain/ctrl/shift/alt click — see
// selectionAnchorStore.ts) and a newly shift-clicked "target" object,
// computes every object whose position falls inside the 3D box the two
// corners span — "click one corner tile, shift-click the opposite corner,
// get everything between".
//
// The box is computed in the base's own grid frame, not world axes: a base
// can be built at an arbitrary yaw inherited from whichever piece was placed
// first (docs/CALIBRATION.md, see coords.ts/Scene.tsx headers), so a naive
// world-aligned box would clip corners on a rotated base. Frame comes from
// the single PalBoxV2's yaw when there is exactly one (campGeometry.ts's
// findPalbox); falls back to world axes (yaw 0) otherwise — same fallback
// convention useKeyboardControls.ts's Shift+Q/E group-rotate pivot uses.
//
// Bounds are expanded by half a tile (200cm, half of GRID_PITCH) on the two
// horizontal grid axes and half a wall (163cm, half of VERTICAL_PITCH
// rounded up) vertically. Without this, anchor and target sitting on the
// same row/column/level would span a zero-width box on that axis and
// silently exclude every piece exactly ON that row/column/level — which is
// where every real foundation/wall actually sits.
import type { PlacedObject, Vec3 } from "../model/types";
import { GRID_PITCH, VERTICAL_PITCH } from "../model/types";
import { findPalbox } from "./campGeometry";
import { localAxesFromYaw, yawFromQuat } from "./coords";

const HALF_TILE = GRID_PITCH / 2; // 200
const HALF_WALL = Math.ceil(VERTICAL_PITCH / 2); // 163 (325 / 2 = 162.5)

function projectXY(pos: Vec3, right: Vec3, forward: Vec3): { u: number; v: number } {
  return {
    u: pos.x * right.x + pos.y * right.y,
    v: pos.x * forward.x + pos.y * forward.y,
  };
}

/**
 * Ids of every object in `allObjects` that falls inside the (inclusive) box
 * spanned by `anchor` and `target`'s positions, expanded per the header
 * above. Includes both `anchor` and `target` themselves.
 */
export function computeRangeSelection(
  anchor: PlacedObject,
  target: PlacedObject,
  allObjects: PlacedObject[],
): string[] {
  const { palbox } = findPalbox(allObjects);
  const yaw = palbox ? yawFromQuat(palbox.rotation) : 0;
  const { forward, right } = localAxesFromYaw(yaw);

  const a = projectXY(anchor.position, right, forward);
  const b = projectXY(target.position, right, forward);

  const uMin = Math.min(a.u, b.u) - HALF_TILE;
  const uMax = Math.max(a.u, b.u) + HALF_TILE;
  const vMin = Math.min(a.v, b.v) - HALF_TILE;
  const vMax = Math.max(a.v, b.v) + HALF_TILE;
  const zMin = Math.min(anchor.position.z, target.position.z) - HALF_WALL;
  const zMax = Math.max(anchor.position.z, target.position.z) + HALF_WALL;

  return allObjects
    .filter((o) => {
      const p = projectXY(o.position, right, forward);
      return p.u >= uMin && p.u <= uMax && p.v >= vMin && p.v <= vMax && o.position.z >= zMin && o.position.z <= zMax;
    })
    .map((o) => o.id);
}
