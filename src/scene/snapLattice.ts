// Per-type snap lattices for Phase 2 place mode (CLAUDE.md §6). PlaceMode.tsx
// previously snapped every armed type to the tile-CENTER lattice (multiples
// of GRID_PITCH/400 in the active anchor's local forward/right frame). Per
// docs/CALIBRATION.md's "Wall placement" section, walls actually sit on tile
// EDGES (200 units — half a tile — off-center along exactly one axis) and
// pillars sit on tile CORNERS (both axes 200 off-center). This module adds
// the two extra lattices and the classify rule that picks one per armed type.
//
// The EDGE-lattice yaw math (which axis carries the odd-200 offset, and
// which of the two possible 90°-apart yaws that implies) was NOT guessed —
// it was derived numerically from fixtures/calibration_01.json's 3 walls
// (each exactly 200 units from foundation "0dc348e9-...") via a throwaway
// node script (see task notes), which confirmed all 3 walls' exact positions
// AND exact yaws before this file was written. Summary of what it found,
// working in the active anchor's own (forward, right) frame — coords.ts's
// localAxesFromYaw(anchorYaw) — with rf/rr the hit point's local coords:
//
//   offset axis = forward, rf < 0  ->  wallYaw = anchorYaw + 0
//   offset axis = forward, rf > 0  ->  wallYaw = anchorYaw + 180
//   offset axis = right,   rr > 0  ->  wallYaw = anchorYaw + 90
//   offset axis = right,   rr < 0  ->  wallYaw = anchorYaw + 270
//
// This lines up exactly with coords.ts's own header comment (wall UE-local Y
// is the length/edge-running axis, UE-local X is the thickness/normal axis):
// rotating UE-local X by wallYaw always lands on the axis+sign above, negated
// (i.e. it points from the wall back toward the host foundation) — so the
// wall's length (local Y) necessarily runs along the *other* (edge/run) axis,
// which is what CLAUDE.md's placement brief requires.
import type { Quat } from "../model/types";
import { GRID_PITCH } from "../model/types";
import { quatMultiply } from "./coords";

export type LatticeKind = "center" | "edge" | "corner";

/**
 * Classify an armed type's snap lattice from its objects.json `size`
 * [length, thickness, height] — task brief's rule, applied verbatim:
 * thin/long pieces (walls, fences, gates, window/door walls) snap to tile
 * EDGES; square, both-axes-thin pieces (pillars) snap to tile CORNERS;
 * everything else (foundations, roofs, stairs, furniture, and any type with
 * unmeasured/unknown dims — objectTypes.ts's [100,100,100] magenta fallback
 * fails both special-case tests) keeps the existing CENTER behavior.
 */
export function classifyLattice(size: readonly [number, number, number]): LatticeKind {
  const [length, thickness] = size;
  if (thickness <= 80 && length >= 300) return "edge";
  if (length <= 80 && thickness <= 80) return "corner";
  return "center";
}

/** Nearest multiple of 200. */
function round200(v: number): number {
  return Math.round(v / 200) * 200;
}

/** v (assumed already a multiple of 200) mod 400, normalized to {0, 200}: 0 = "even" tile-center lattice, 200 = "odd" tile-edge/corner lattice. */
function classOf(v: number): 0 | 200 {
  const m = ((v % 400) + 400) % 400;
  return m === 0 ? 0 : 200;
}

/** Nearest value of a given mod-400 class (0 = nearest multiple of 400, 200 = nearest odd multiple of 200, i.e. 400k+200) to a raw coordinate. */
function nearestWithClass(v: number, targetClass: 0 | 200): number {
  return targetClass === 0 ? Math.round(v / 400) * 400 : Math.round((v - 200) / 400) * 400 + 200;
}

export interface EdgeSnap {
  rf: number;
  rr: number;
  /** Which local axis (of the active anchor's forward/right frame) carries the odd-200 offset — the wall's thickness/normal direction. */
  axis: "forward" | "right";
  /** Sign of that axis's snapped value — which of the two parallel edges on that axis. */
  sign: 1 | -1;
}

/**
 * Snap a hit point's (rf, rr) — already projected onto the active anchor's
 * local (forward, right) axes, see PlaceMode.tsx — to the EDGE lattice: valid
 * points have exactly ONE coordinate an odd multiple of 200 (the offset/
 * normal axis) and the other a multiple of 400 (the run/edge axis).
 *
 * Algorithm (task brief): round each coordinate independently to the nearest
 * 200. If both land in the same mod-400 class (both "even" tile-centers or
 * both "odd" tile-edges — i.e. NOT a valid edge point), push the coordinate
 * with the larger rounding residual (the one we're less sure about) to its
 * nearest valid value of the opposite class. On an exact tie (equidistant —
 * literally at a foundation corner) `preferForwardOffset` breaks it: true
 * keeps `forward` as the offset axis (pushes `right` instead), false the
 * reverse — this is the "R" ghost-rotation toggle's effect on EDGE pieces.
 */
export function snapEdgeLattice(rf: number, rr: number, preferForwardOffset: boolean): EdgeSnap {
  const sf = round200(rf);
  const sr = round200(rr);
  const classF = classOf(sf);
  const classR = classOf(sr);
  let finalF = sf;
  let finalR = sr;
  if (classF === classR) {
    const residF = Math.abs(rf - sf);
    const residR = Math.abs(rr - sr);
    // Push F (so R keeps its rounded value and F becomes the odd axis) when
    // F's residual is strictly larger, OR (tie) when forward is preferred.
    const pushForward = residF === residR ? preferForwardOffset : residF > residR;
    if (pushForward) {
      finalF = nearestWithClass(rf, classR === 0 ? 200 : 0);
    } else {
      finalR = nearestWithClass(rr, classF === 0 ? 200 : 0);
    }
  }
  const axis: "forward" | "right" = classOf(finalF) === 200 ? "forward" : "right";
  const axisVal = axis === "forward" ? finalF : finalR;
  return { rf: finalF, rr: finalR, axis, sign: axisVal < 0 ? -1 : 1 };
}

/** CORNER lattice (pillars): both local coords snap to the nearest odd-200 multiple (400k+200) — task brief. */
export function snapCornerLattice(rf: number, rr: number): { rf: number; rr: number } {
  return { rf: nearestWithClass(rf, 200), rr: nearestWithClass(rr, 200) };
}

/** CENTER lattice (foundations, roofs, furniture, unknown-dims types — pre-existing default behavior): both coords to the nearest GRID_PITCH (400) multiple. */
export function snapCenterLattice(rf: number, rr: number): { rf: number; rr: number } {
  return { rf: Math.round(rf / GRID_PITCH) * GRID_PITCH, rr: Math.round(rr / GRID_PITCH) * GRID_PITCH };
}

/**
 * Yaw delta (degrees, about Z) to add to the active anchor's rotation for an
 * EDGE piece so its length (UE-local Y) runs along the edge/run axis — see
 * this file's header for the numeric derivation against the 3 calibration
 * walls.
 */
export function edgeYawOffsetDeg(axis: "forward" | "right", sign: 1 | -1): number {
  if (axis === "forward") return sign < 0 ? 0 : 180;
  return sign > 0 ? 90 : 270;
}

/** Rotate a quaternion by a Z-axis yaw offset in whole degrees: q' = qz ⊗ q — same world-space-stack convention as useKeyboardControls.ts's Q/E rotate. deg === 0 short-circuits to `q` unchanged (avoids a needless renormalize). */
export function rotateQuatByDeg(q: Quat, deg: number): Quat {
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 0) return q;
  const half = (norm * Math.PI) / 360;
  const qz: Quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
  return quatMultiply(qz, q);
}
