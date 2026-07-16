// Shared palbox/camp-radius helpers used by both the sidebar (radius
// guardrail + relocate-base panel, src/ui/Sidebar.tsx,
// src/ui/RelocateBasePanel.tsx) and the 3D radius ring
// (src/scene/RadiusRing.tsx). Single source of truth so "which object is the
// palbox" and "who's outside the radius" can't drift between the two views.
//
// Deliberately keyed on the LIVE palbox object position, not camp.position
// (the camp anchor captured at load time) — per the task brief, the camp
// anchor follows the palbox at export, so the radius check must track
// wherever the palbox has been moved to during editing, not where it started.
import type { PlacedObject } from "../model/types";

/** MapObjectId.value for the palbox — confirmed in docs/CALIBRATION.md's object type vocabulary. */
export const PALBOX_TYPE_ID = "PalBoxV2";

export interface PalboxLookup {
  palbox: PlacedObject | null;
  /** Set when palbox is null: why relocation/radius features are unavailable. */
  reason: string | null;
}

/** Finds the single PalBoxV2 object, or explains why one wasn't found. */
export function findPalbox(objects: PlacedObject[]): PalboxLookup {
  const matches = objects.filter((o) => o.typeId === PALBOX_TYPE_ID);
  if (matches.length === 0) {
    return { palbox: null, reason: "no PalBoxV2 object found in this file" };
  }
  if (matches.length > 1) {
    return { palbox: null, reason: `${matches.length} PalBoxV2 objects found — expected exactly one` };
  }
  return { palbox: matches[0], reason: null };
}

/** Horizontal (UE x/y) distance between two positions — ignores Z/elevation. */
function horizontalDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Count of objects whose horizontal distance from `center` exceeds `radius`. */
export function countOutsideRadius(
  objects: PlacedObject[],
  center: { x: number; y: number },
  radius: number,
): number {
  return objects.reduce((n, o) => (horizontalDistance(o.position, center) > radius ? n + 1 : n), 0);
}
