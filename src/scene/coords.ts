// Unreal <-> three.js coordinate conversion (CLAUDE.md §8, docs/CALIBRATION.md).
//
// Unreal is centimetres, Z-up, LEFT-handed. three.js is metres (by our own
// convention below), Y-up, RIGHT-handed. We convert with a single fixed axis
// swap: three.(x, y, z) = ue.(x, z, y) * SCALE. Swapping two axes is an odd
// permutation (determinant -1) of the coordinate frame, which is exactly
// what's needed to turn a left-handed frame into a right-handed one while
// keeping "up" as up (UE's Z stays vertical, becomes three's Y).
//
// Rotations: if a quaternion q represents rotation matrix R in UE-space, and
// M is the (involutory, orthogonal) axis-swap above, then the "same" rotation
// re-expressed in three-space is the conjugate R' = M·R·M. The formula
// `three.Quaternion(q.x, q.z, q.y, -q.w)` computes exactly that conjugation.
//
// VERIFIED numerically against fixtures/calibration_01.json (not assumed):
// for each of the 3 calibration walls, rotating UE-local (1,0,0) by the
// wall's own quaternion — using the plain Hamilton rotate-vector formula in
// UE-space, then axis-swapping the result — lands on the exact same vector
// (to ~1e-10) as rotating three-local (1,0,0) by the converted quaternion
// above. Cross-checked at 3 different yaws (164.11°, -105.89°, -15.89°), so
// this isn't a coincidence of one rotation. No mirroring / sign flip needed
// beyond the -w term already in the formula.
//
// That same check surfaced something NOT obvious from objects.json's own
// "[x, y, z] full extents" comment: a wall's UE-local X axis is its
// THICKNESS (radial, normal-to-the-wall-face) direction, and UE-local Y is
// its LENGTH (tangential, running along the foundation edge) — the reverse
// of naively reading size[0] as the local-X extent. Concretely: for all 3
// calibration walls, the direction from the host foundation to the wall
// equals -1 times "UE-local (1,0,0) rotated by the wall's quaternion",
// exactly (dot product 1.0), independent of yaw. size[0] (400, the long
// dimension) therefore has to be placed along local Y, and size[1] (20, the
// short one) along local X. Foundations/pillars/roof have square footprints
// (size[0] === size[1]) so this is a no-op for them either way — walls are
// the only type where getting it backwards would be visible (a thin sliver
// poking out radially instead of a flat panel lying along the edge).
import * as THREE from "three";
import type { Quat, Vec3 } from "../model/types";

/** cm -> m. Keeps camera distances, OrbitControls speed, etc. in sane ranges. */
export const UNIT_SCALE = 0.01;

/** Convert an Unreal-space position (cm) to a three.js position (m). No recentring here — see Scene.tsx's centroid subtraction. */
export function ueVecToThree(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x * UNIT_SCALE, v.z * UNIT_SCALE, v.y * UNIT_SCALE);
}

/**
 * Inverse of ueVecToThree: a three.js position (m) back to Unreal space (cm).
 * Used by PlaceMode.tsx to turn a ground-plane raycast hit (computed in the
 * scene's recentred three.js space) back into Unreal coordinates for
 * placeObject(). No recentring here either — callers add centroidThree back
 * onto the three.js point before calling this, mirroring ueVecToThree's
 * "no recentring" contract in the other direction.
 */
export function threeVecToUe(v: THREE.Vector3): Vec3 {
  return { x: v.x / UNIT_SCALE, y: v.z / UNIT_SCALE, z: v.y / UNIT_SCALE };
}

/** Convert an Unreal-space rotation quaternion to its three.js equivalent. See file header for the derivation/verification. */
export function ueQuatToThree(q: Quat): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.z, q.y, -q.w).normalize();
}

/**
 * Convert a three.js DIRECTION vector (e.g. a raycast hit face's world-space
 * normal) to Unreal space — same axis swap as position/rotation conversion
 * above, but deliberately WITHOUT the cm<->m scale factor ueVecToThree/
 * threeVecToUe apply: a direction has no "position" to rescale, and running
 * it through threeVecToUe would just inflate its magnitude by 1/UNIT_SCALE
 * (harmless for classifying the dominant axis, since that's a uniform scale,
 * but confusing if this value is ever logged mid-debugging). Used by
 * PlaceMode.tsx to classify which face (top/side/bottom) of a placed
 * object's proxy geometry the pointer's ray hit.
 */
export function threeDirToUe(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.z, z: v.y };
}

/**
 * objects.json's `size` is [length, thickness, height] in UE units (see file
 * header re: which local axis each maps to). Returns three.js
 * <boxGeometry args> order [width(three-X), height(three-Y), depth(three-Z)],
 * already scaled to metres.
 */
export function ueSizeToThreeBoxArgs(size: readonly [number, number, number]): [number, number, number] {
  const [length, thickness, height] = size;
  return [thickness * UNIT_SCALE, height * UNIT_SCALE, length * UNIT_SCALE];
}

/**
 * Yaw about the Unreal Z axis, in radians, from a pure-yaw quaternion
 * (rot.x ≈ rot.y ≈ 0 — true for every object observed in the calibration
 * fixture, structures and free-placed furniture alike; docs/CALIBRATION.md).
 * Matches the task brief's formula: yaw = 2*atan2(rot.z, rot.w).
 */
export function yawFromQuat(q: Quat): number {
  return 2 * Math.atan2(q.z, q.w);
}

/** Local grid axes (Unreal-space, unit vectors in the XY plane) for a given yaw. */
export function localAxesFromYaw(yaw: number): { forward: Vec3; right: Vec3 } {
  return {
    forward: { x: Math.cos(yaw), y: Math.sin(yaw), z: 0 },
    right: { x: Math.sin(yaw), y: -Math.cos(yaw), z: 0 },
  };
}

/** Hamilton product a⊗b (both {x,y,z,w}). Used for in-place Q/E rotation: q' = qz ⊗ q. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
