// Overlap prevention for Phase 2 place mode (CLAUDE.md §6) — every
// interactive placement path (single stamp, Shift/Ctrl+Shift array fills,
// Base Circle fill, Vertical Stack, Shift+PageUp/PageDown stamps) must skip
// creating a piece when an object of the SAME typeId already exists within
// POSITION_TOLERANCE of the target position. Thin/edge pieces (walls) are
// the one exception that needs a second key: two walls may legitimately
// share an edge back-to-back with opposite facing (an outer wall + an inner
// lining wall on the same tile boundary — see tools/gen-cladding.ts's own
// wall-quadrant dedup key for the same real-world pattern; reimplemented
// locally here since tools/ is off-limits to this feature — see task brief's
// file-ownership note), so for those we also require the facing QUADRANT to
// match before calling it a duplicate.
//
// A fresh spatial hash is built once per placement batch (a single click, or
// one Fill/Stack button press) from the LIVE store's current objects, then
// consulted (and topped up with newly-accepted pieces from the SAME batch,
// so a fill can't stamp two overlapping cells onto each other either) as
// each candidate position is considered. Recomputing per batch — rather than
// maintaining a long-lived incrementally-updated index — is deliberately the
// simple option: CLAUDE.md's own "recompute per placement batch; a spatial
// hash keyed by rounded position is fine" guidance.
//
// Consumed by:
// - src/scene/Scene.tsx (onPointerMissed) / src/scene/ObjectBox.tsx
//   (onClick): single stamps and Shift/Ctrl+Shift array fills.
// - src/scene/useKeyboardControls.ts: Shift+PageUp/PageDown stamps.
// - src/ui/FillCirclePanel.tsx / src/ui/VerticalStackPanel.tsx: their own
//   placeObject() loops.
// - src/ui/Sidebar.tsx (guardrail section, Fix 3): reuses isFacingSensitive
//   + yawQuadrant to find and select existing duplicate clusters.
import type { PlacedObject, Quat, Vec3 } from "../model/types";
import { classifyLattice } from "./snapLattice";
import { resolveType } from "./objectTypes";
import { yawFromQuat } from "./coords";

/** Horizontal+vertical distance (UE units) within which a same-typeId object counts as "already placed here" — task brief. */
export const OVERLAP_TOLERANCE = 50;

/** Spatial hash bucket size — > 2x OVERLAP_TOLERANCE so a 3x3x3 neighbour search around any point's own bucket is guaranteed to cover every object within OVERLAP_TOLERANCE of it, regardless of where within its bucket it falls. */
const BUCKET_SIZE = OVERLAP_TOLERANCE * 2;

/** Thin/edge-lattice pieces (walls, fences, gates — see snapLattice.ts's classifyLattice) may legitimately share a position back-to-back with opposite facing; every other type (including corner-lattice pillars, which have no meaningful "facing") is deduped on position alone. */
export function isFacingSensitive(typeId: string): boolean {
  return classifyLattice(resolveType(typeId).size) === "edge";
}

/** Which of the 4 cardinal directions a rotation's yaw is nearest to, 0-3 — the "facing quadrant" used to distinguish back-to-back walls (same edge, opposite face) from true duplicates (same edge, same face). Rounds to the nearest 90° family the same way structural yaws are always found in practice (docs/CALIBRATION.md — structures snap in 90° steps). */
export function yawQuadrant(rotation: Quat): number {
  const deg = (yawFromQuat(rotation) * 180) / Math.PI;
  return ((Math.round(deg / 90) % 4) + 4) % 4;
}

function bucketCoord(v: number): number {
  return Math.floor(v / BUCKET_SIZE);
}

function bucketKey(x: number, y: number, z: number): string {
  return `${bucketCoord(x)},${bucketCoord(y)},${bucketCoord(z)}`;
}

/** Fresh-per-batch spatial hash of live objects, keyed by rounded position — see file header. */
export interface OverlapIndex {
  buckets: Map<string, PlacedObject[]>;
}

export function buildOverlapIndex(objects: PlacedObject[]): OverlapIndex {
  const buckets = new Map<string, PlacedObject[]>();
  for (const o of objects) {
    const key = bucketKey(o.position.x, o.position.y, o.position.z);
    const arr = buckets.get(key);
    if (arr) arr.push(o);
    else buckets.set(key, [o]);
  }
  return { buckets };
}

/** Records a just-accepted placement in the index so the REST of the same batch (a line/rect fill, a circle fill, a vertical stack) can't stamp a second overlapping piece onto a cell already filled earlier in that same batch. */
export function addToOverlapIndex(index: OverlapIndex, o: PlacedObject): void {
  const key = bucketKey(o.position.x, o.position.y, o.position.z);
  const arr = index.buckets.get(key);
  if (arr) arr.push(o);
  else index.buckets.set(key, [o]);
}

/**
 * The existing object (if any) that makes placing `typeId` at
 * `position`/`rotation` a duplicate — same typeId, within OVERLAP_TOLERANCE
 * (horizontal AND vertical), and — for facing-sensitive (edge-lattice)
 * types only — the same facing quadrant. Null when the placement is clear.
 */
export function findOverlap(index: OverlapIndex, typeId: string, position: Vec3, rotation: Quat): PlacedObject | null {
  const facingSensitive = isFacingSensitive(typeId);
  const targetQuadrant = facingSensitive ? yawQuadrant(rotation) : -1;
  const bx = bucketCoord(position.x);
  const by = bucketCoord(position.y);
  const bz = bucketCoord(position.z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = index.buckets.get(`${bx + dx},${by + dy},${bz + dz}`);
        if (!arr) continue;
        for (const o of arr) {
          if (o.typeId !== typeId) continue;
          const horiz = Math.hypot(o.position.x - position.x, o.position.y - position.y);
          if (horiz > OVERLAP_TOLERANCE) continue;
          if (Math.abs(o.position.z - position.z) > OVERLAP_TOLERANCE) continue;
          if (facingSensitive && yawQuadrant(o.rotation) !== targetQuadrant) continue;
          return o;
        }
      }
    }
  }
  return null;
}

/**
 * Grouping granularity for findDuplicateClusters below — same 50-unit
 * rounding as tools/gen-cladding.ts's own dedup key (posKey), reimplemented
 * locally (tools/ is off-limits to this feature — see file header). Equal to
 * OVERLAP_TOLERANCE so "in the same cluster" and "counts as an overlap" mean
 * the same distance.
 */
const CLUSTER_ROUND = OVERLAP_TOLERANCE;

function clusterKey(o: PlacedObject): string {
  const rx = Math.round(o.position.x / CLUSTER_ROUND);
  const ry = Math.round(o.position.y / CLUSTER_ROUND);
  const rz = Math.round(o.position.z / CLUSTER_ROUND);
  const facet = isFacingSensitive(o.typeId) ? `:${yawQuadrant(o.rotation)}` : "";
  return `${o.typeId}|${rx},${ry},${rz}${facet}`;
}

export interface DuplicateClusters {
  /**
   * ids of every object that is an EXTRA — beyond the first encountered —
   * within its own same-typeId/position(50u)/facing cluster. Deleting
   * exactly these ids (keeping one survivor per cluster) removes all
   * guardrail-flagged overlap. Order follows input array order, so the
   * "survivor" of each cluster is always the one that appears first in
   * `objects` (stable, no reliance on insertion-order-of-a-Map quirks).
   */
  extraIds: string[];
}

/**
 * Duplicate guardrail (Fix 3, Sidebar.tsx): groups `objects` by the same
 * same-typeId/position(50u)/facing-quadrant-for-edge-pieces identity
 * `findOverlap` uses, and reports every object beyond the first in each
 * group as an "extra" — safe to delete, since one survivor per cluster keeps
 * the base intact. Pure grouping (no store access), memoizable by callers on
 * `objects` identity.
 */
export function findDuplicateClusters(objects: PlacedObject[]): DuplicateClusters {
  const groups = new Map<string, PlacedObject[]>();
  for (const o of objects) {
    const key = clusterKey(o);
    const arr = groups.get(key);
    if (arr) arr.push(o);
    else groups.set(key, [o]);
  }
  const extraIds: string[] = [];
  for (const group of groups.values()) {
    for (let i = 1; i < group.length; i++) extraIds.push(group[i].id);
  }
  return { extraIds };
}

export interface StampResult {
  placed: number;
  skipped: number;
}

/**
 * Shared placement loop for every interactive placement path (single stamp,
 * line/rect array fill, Base Circle fill, Vertical Stack, Shift+PageUp/
 * PageDown stamps) — places each of `positions` (all sharing `typeId` and
 * `rotation`) via `placeObject`, skipping any that overlap an existing
 * same-typeId object per `findOverlap` above. The overlap index is built
 * ONCE from `liveObjects` (the batch's starting snapshot) and topped up with
 * each newly-accepted position as the loop goes, so a fill can't stamp two
 * overlapping cells onto each other within the same batch either — see the
 * file header's "recompute per placement batch" note.
 */
export function stampWithOverlapCheck(
  liveObjects: PlacedObject[],
  typeId: string,
  positions: Vec3[],
  rotation: Quat,
  placeObject: (typeId: string, position: Vec3, rotation: Quat) => void,
): StampResult {
  const index = buildOverlapIndex(liveObjects);
  let placed = 0;
  let skipped = 0;
  for (const position of positions) {
    if (findOverlap(index, typeId, position, rotation)) {
      skipped++;
      continue;
    }
    placeObject(typeId, position, rotation);
    placed++;
    // Placeholder entry: only typeId/position/rotation are ever read back
    // out of the index (findOverlap), so the other PlacedObject fields don't
    // need to reflect the real minted object.
    addToOverlapIndex(index, { id: "", typeId, position, rotation, scale: { x: 1, y: 1, z: 1 }, origin: "placed" });
  }
  return { placed, skipped };
}
