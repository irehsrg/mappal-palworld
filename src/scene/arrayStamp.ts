// Array-stamping math for Phase 2 place mode (UX task "B. Array stamping").
// Shift+click while armed fills a straight LINE from the last stamped
// position to the clicked cell; Ctrl+Shift+click fills the grid-aligned
// RECTANGLE between them. Both operate in the same rotated "base grid"
// frame PlaceMode.tsx already snaps to (see coords.ts's localAxesFromYaw),
// so a fill follows a rotated base's own grid, not world axes.
//
// Consumed by:
// - src/scene/PlaceMode.tsx: computes the ghost preview array while
//   hovering with Shift/Ctrl+Shift held.
// - src/scene/Scene.tsx (onPointerMissed) / src/scene/ObjectBox.tsx
//   (onClick): computes the actual set of positions to stamp on a real
//   click, looping placeObject() once per position (CLAUDE.md-adjacent
//   file-ownership note: this intentionally produces N undo-stack entries
//   per fill rather than one — see task brief and the palette's armed-hint
//   copy in src/ui/Palette.tsx for the documented limitation).
import type { Vec3 } from "../model/types";
import { GRID_PITCH } from "../model/types";
import { localAxesFromYaw } from "./coords";

/** Hard cap on pieces placed (or previewed) by a single fill click — task brief. */
export const MAX_STAMP_COUNT = 200;

export type StampMode = "single" | "line" | "rect";

/** Shift = line, Ctrl+Shift = rect, anything else = a plain single stamp. */
export function stampModeFromModifiers(shiftKey: boolean, ctrlKey: boolean): StampMode {
  if (shiftKey && ctrlKey) return "rect";
  if (shiftKey) return "line";
  return "single";
}

/** Local (forward, right) grid-step offsets of `to` relative to `from`, rounded to the nearest whole grid step (both points are already grid-snapped by PlaceMode.tsx, so this is normally exact). */
function localSteps(from: Vec3, to: Vec3, yaw: number): { nf: number; nr: number; forward: Vec3; right: Vec3 } {
  const { forward, right } = localAxesFromYaw(yaw);
  const relX = to.x - from.x;
  const relY = to.y - from.y;
  const nf = Math.round((relX * forward.x + relY * forward.y) / GRID_PITCH);
  const nr = Math.round((relX * right.x + relY * right.y) / GRID_PITCH);
  return { nf, nr, forward, right };
}

/**
 * New grid cells a fill click would stamp, EXCLUDING `from` itself (that
 * cell already holds the piece placed by the click that set the anchor —
 * re-placing it would stack a duplicate on top). For "single" mode, or when
 * there's no anchor yet (first stamp of an armed session), this is just
 * `[to]`. Capped at `cap` pieces (default MAX_STAMP_COUNT); the full,
 * uncapped count is available via stampFillNewCount for the preview badge.
 */
export function computeStampFill(
  from: Vec3 | null,
  to: Vec3,
  yaw: number,
  mode: StampMode,
  cap: number = MAX_STAMP_COUNT,
): Vec3[] {
  if (mode === "single" || !from) return [to];
  const { nf, nr, forward, right } = localSteps(from, to, yaw);

  const positions: Vec3[] = [];
  if (mode === "line") {
    // Constrain to the dominant axis; the other axis holds at `from`'s value
    // (a straight run even if the cursor drifted slightly off-axis).
    const useForward = Math.abs(nf) >= Math.abs(nr);
    const n = useForward ? nf : nr;
    const axis = useForward ? forward : right;
    const step = Math.sign(n);
    const count = Math.abs(n) + 1; // includes `from` at i=0
    for (let i = 1; i < count && positions.length < cap; i++) {
      positions.push({
        x: from.x + axis.x * GRID_PITCH * step * i,
        y: from.y + axis.y * GRID_PITCH * step * i,
        z: to.z,
      });
    }
  } else {
    // rect: full grid spanning both axes between `from` and `to`.
    const stepF = Math.sign(nf);
    const stepR = Math.sign(nr);
    const countF = Math.abs(nf) + 1;
    const countR = Math.abs(nr) + 1;
    outer: for (let i = 0; i < countF; i++) {
      for (let j = 0; j < countR; j++) {
        if (i === 0 && j === 0) continue; // `from` itself — already placed
        if (positions.length >= cap) break outer;
        positions.push({
          x: from.x + forward.x * GRID_PITCH * stepF * i + right.x * GRID_PITCH * stepR * j,
          y: from.y + forward.y * GRID_PITCH * stepF * i + right.y * GRID_PITCH * stepR * j,
          z: to.z,
        });
      }
    }
  }
  return positions;
}

/** Uncapped count of NEW cells (excluding `from`) a fill would produce — for the preview badge, so it can show "200 of 812" when a fill is being clipped. */
export function stampFillNewCount(from: Vec3 | null, to: Vec3, yaw: number, mode: StampMode): number {
  if (mode === "single" || !from) return 1;
  const { nf, nr } = localSteps(from, to, yaw);
  if (mode === "line") return Math.max(Math.abs(nf), Math.abs(nr));
  return (Math.abs(nf) + 1) * (Math.abs(nr) + 1) - 1;
}
