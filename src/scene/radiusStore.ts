// Base-radius multiplier — a VIEW-ONLY lens over camp.areaRange.
//
// Requested by a user running a base-radius-expanding mod: with a modded
// radius the vanilla area_range (3500 in the calibration fixture) makes the
// editor nag about objects that are perfectly legal in their game, and caps
// the circle-fill tool well short of what they can actually build on.
//
// CRITICAL: this NEVER touches the exported file. area_range is passed
// through verbatim like every other field we don't fully own (CLAUDE.md C4/C5)
// — the radius a base actually gets in-game is decided by the game and
// whatever mod is installed, not by us. This multiplier only scales:
//   - the guardrail's "objects outside base radius" count (Sidebar.tsx)
//   - the reference ring drawn on the ground plane (RadiusRing.tsx)
//   - how far the circle-fill tool is allowed to reach (FillCirclePanel.tsx)
// Same category of thing as visibilityStore.ts: a lens, not model state.
import { create } from "zustand";

const STORAGE_KEY = "mappal.radiusMultiplier";

/** Generous but finite — x8 on a 3500 base is a 28,000uu radius, far past any
 *  reported mod. A cap keeps a fat-fingered "80" from trying to fill a disk
 *  with millions of tiles. */
export const MAX_MULTIPLIER = 8;
export const MIN_MULTIPLIER = 1;

function loadMultiplier(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(v) && v >= MIN_MULTIPLIER && v <= MAX_MULTIPLIER) return v;
  } catch {
    // Best-effort persistence only — private-mode/blocked storage is fine.
  }
  return 1;
}

export function clampMultiplier(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, v));
}

interface RadiusState {
  /** Scales the file's area_range for guardrails/tools. 1 = vanilla. */
  multiplier: number;
  setMultiplier: (v: number) => void;
}

export const useRadiusStore = create<RadiusState>((set) => ({
  multiplier: loadMultiplier(),
  setMultiplier: (v) => {
    const multiplier = clampMultiplier(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(multiplier));
    } catch {
      // Ignore — the setting just won't survive a reload.
    }
    set({ multiplier });
  },
}));

/** The radius every guardrail and tool should actually use, in Unreal units. */
export function effectiveRadius(areaRange: number, multiplier: number): number {
  return areaRange * clampMultiplier(multiplier);
}
