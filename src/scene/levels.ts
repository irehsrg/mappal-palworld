// Level assignment for the Unity-Hierarchy-style Levels panel
// (src/ui/LevelsPanel.tsx) and the viewport visibility lens
// (visibilityStore.ts). A "level" is a whole floor count relative to the
// palbox's Z (or world Z=0 when there's no palbox) — the exact same
// VERTICAL_PITCH-based math PlaceMode.tsx's ghost-hint label already uses
// for its own "L4" readout, just generalized here to every placed object
// instead of only the placement ghost.
import type { PlacedObject } from "../model/types";
import { VERTICAL_PITCH } from "../model/types";

/** Whole-floor level for a Z position relative to the palbox (or world origin if there's no palbox — same fallback PlaceMode.tsx uses). */
export function levelOf(z: number, palboxZ: number | null): number {
  return Math.round((z - (palboxZ ?? 0)) / VERTICAL_PITCH);
}

export interface LevelGroup {
  level: number;
  objects: PlacedObject[];
}

/**
 * Groups objects by level, sorted ascending. Cheap (single pass + sort) but
 * still meant to be memoized by the caller on `objects` identity (and
 * palboxZ) — see LevelsPanel.tsx — since it's recomputed on every render
 * otherwise.
 */
export function buildLevelIndex(objects: PlacedObject[], palboxZ: number | null): LevelGroup[] {
  const map = new Map<number, PlacedObject[]>();
  for (const o of objects) {
    const level = levelOf(o.position.z, palboxZ);
    const arr = map.get(level);
    if (arr) arr.push(o);
    else map.set(level, [o]);
  }
  return [...map.entries()]
    .map(([level, objs]) => ({ level, objects: objs }))
    .sort((a, b) => a.level - b.level);
}
