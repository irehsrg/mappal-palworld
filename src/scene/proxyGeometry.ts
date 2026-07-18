// Parametric proxy geometry (CLAUDE.md C2 — procedural three.js only, no
// game assets ever). Upgrades the plain gray box to shapes derived from the
// typeId's *name* (never from any ripped asset), so a silhouette reads as
// "window wall", "stair", "pyramid roof" etc. at a glance. See ObjectBox.tsx
// / PlaceMode.tsx for how this plugs into the mesh.
//
// ANCHOR CONVENTION (replaces the old "centered BoxGeometry + half-height
// mesh-position offset" trick that ObjectBox.tsx used to use): every
// geometry built here is NOT centered on the vertical axis. For
// originAtTop=false (everything except foundations) it spans local Y in
// [0, height] — the shape's bottom sits at local Y=0. For originAtTop=true
// (foundations) it spans local Y in [-height, 0] — the shape's top sits at
// local Y=0. The mesh is then positioned directly at the object's own
// (converted) Z with NO extra offset.
//
// This is mathematically identical to the old convention for a plain box:
// old mesh.y = (objZ ± halfHeight)*SCALE with a box spanning ±halfHeight
// around that center puts the box's bottom/top edge at objZ*SCALE exactly;
// new mesh.y = objZ*SCALE with a box spanning [0,height] or [-height,0]
// puts the same edge at the same world position. Verified by hand for both
// origin conventions — nothing shifts relative to the pre-upgrade renderer.
// The benefit: shapes whose *visual* height needs to differ from the
// registry's dimension (pyramidroof's ~150cm apex vs. the registry's 30cm
// slab "thickness", used elsewhere for the flat-box fallback) can do that
// without any extra bookkeeping — they're still bottom-anchored at Y=0.
//
// AXIS MAPPING (see coords.ts header, verified against calibration data):
// objects.json size = [x=length, y=thickness, z=vertical]. The existing
// ueSizeToThreeBoxArgs maps three-local X = size[1] (thickness/short),
// three-local Z = size[0] (length/long), three-local Y = size[2]
// (vertical) — the horizontal footprint lives in the three X/Z plane,
// centered at the object's origin; only Y is anchored per the convention
// above. Every builder below follows that same mapping so a custom shape
// lines up with its neighbors exactly like a box would.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { UNIT_SCALE } from "./coords";

type ShapeKind =
  | "box"
  | "triangleFoundation"
  | "triangleWall"
  | "triangleWallReverse"
  | "diagonalWall"
  | "windowWall"
  | "doorWall"
  | "wallGate"
  | "pyramidRoof"
  | "slantedRoof"
  | "slopedRoofCorner"
  | "slopedRoofCornerReverse"
  | "stair"
  | "fence"
  | "ladder";

/**
 * Case-insensitive substring classification of a typeId into a shape kind.
 * Most-specific rules first — e.g. "TriangleWallReverse" must be checked
 * before the plain "trianglewall" rule, or it'd never be reached.
 */
function classifyShape(typeId: string): ShapeKind {
  const k = typeId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (k.includes("trianglewallreverse")) return "triangleWallReverse";
  if (k.includes("trianglewall")) return "triangleWall";
  if (k.includes("trianglefoundation")) return "triangleFoundation";
  // Corner stairs: reuse the straight staircase (task brief explicitly
  // allows this simplification — see report).
  if (k.includes("trianglestairscorner")) return "stair";
  if (k.includes("diagonalwall")) return "diagonalWall";
  if (k.includes("windowwall")) return "windowWall";
  if (k.includes("doorwall")) return "doorWall";
  if (k.includes("wallgate")) return "wallGate";
  if (k.includes("pyramidroof")) return "pyramidRoof";
  if (k.includes("slopedroofcornerreverse")) return "slopedRoofCornerReverse";
  if (k.includes("slopedroofcorner")) return "slopedRoofCorner";
  if (k.includes("slantedroof")) return "slantedRoof";
  // Not called out explicitly in the brief, but "Triangle Roof" is a gable
  // roof piece — same wedge silhouette as slantedroof. Falling through to a
  // flat box would lose the one bit of shape info that matters here.
  if (k.includes("triangleroof")) return "slantedRoof";
  if (k.includes("stair")) return "stair";
  if (k.includes("fence")) return "fence";
  if (k.includes("ladder")) return "ladder";
  return "box";
}

// Keyed by shape+size+origin signature rather than raw typeId: many typeIds
// (e.g. Wood_TriangleWall vs. Stone_TriangleWall) are geometrically
// identical and only differ in material tint, so this shares one
// BufferGeometry across all of them too — a strict superset of "cache per
// typeId".
const geometryCache = new Map<string, THREE.BufferGeometry>();

/**
 * Piece-boundary overlay (placement UX fix: "no idea where pieces end or
 * start" with hundreds of identical flat-shaded pieces). Cached under the
 * SAME key as geometryCache above — see geometryKey() below — so hundreds of
 * ObjectBox instances of the same shape+size share one edges buffer too,
 * same rationale as the proxy geometry cache itself.
 */
const edgesCache = new Map<string, THREE.EdgesGeometry>();

/** Threshold angle (degrees) for EdgesGeometry: only draw an edge where adjacent faces meet at >= this angle, so a flat box's 4 side faces don't get a seam drawn down their (coplanar, 0°) shared edges — only real silhouette/crease edges. */
const EDGES_THRESHOLD_DEG = 25;

/** Cache key shared by getProxyGeometry and getProxyEdges — MUST stay identical between the two so a shape+size always shares one geometry AND one edges buffer, never two independent lookups that could drift. */
function geometryKey(typeId: string, size: readonly [number, number, number], originAtTop: boolean, isUnknownDims: boolean): string {
  const kind = isUnknownDims ? "box" : classifyShape(typeId);
  return `${kind}|${size[0]}|${size[1]}|${size[2]}|${originAtTop}`;
}

/**
 * Build (or return the cached) proxy geometry for a typeId, in metres,
 * already positioned per the anchor convention above.
 *
 * @param size raw [x,y,z] cm extents from objects.json (TypeEntry.size).
 * @param originAtTop mirrors objectTypes.ts's TypeEntry.originAtTop.
 * @param isUnknownDims when true, always returns the plain-box fallback
 *   regardless of what the typeId's name looks like — a magenta "we don't
 *   have dimensions for this one" object should never turn into a
 *   confidently-wrong exotic shape.
 */
export function getProxyGeometry(
  typeId: string,
  size: readonly [number, number, number],
  originAtTop: boolean,
  isUnknownDims: boolean,
): THREE.BufferGeometry {
  const kind = isUnknownDims ? "box" : classifyShape(typeId);
  const key = geometryKey(typeId, size, originAtTop, isUnknownDims);
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geo = build(kind, size, originAtTop);
  geometryCache.set(key, geo);
  return geo;
}

/**
 * Thin dark edge overlay for a placed object's proxy geometry (ObjectBox.tsx
 * only — NOT the translucent ghost or fill-preview ghosts in PlaceMode.tsx,
 * where it's just visual noise on top of an already-translucent shape and
 * pure wasted cost on the fill-preview's N ghost copies). Built once per
 * shape+size (via getProxyGeometry's own cache) and cached again here so
 * hundreds of same-shape ObjectBox instances share one EdgesGeometry buffer.
 */
export function getProxyEdges(
  typeId: string,
  size: readonly [number, number, number],
  originAtTop: boolean,
  isUnknownDims: boolean,
): THREE.EdgesGeometry {
  const key = geometryKey(typeId, size, originAtTop, isUnknownDims);
  const cached = edgesCache.get(key);
  if (cached) return cached;
  const proxy = getProxyGeometry(typeId, size, originAtTop, isUnknownDims);
  const edges = new THREE.EdgesGeometry(proxy, EDGES_THRESHOLD_DEG);
  edgesCache.set(key, edges);
  return edges;
}

function build(kind: ShapeKind, size: readonly [number, number, number], originAtTop: boolean): THREE.BufferGeometry {
  const [xCm, yCm, zCm] = size;
  const lenM = xCm * UNIT_SCALE; // -> three Z (footprint "long" axis)
  const thickM = yCm * UNIT_SCALE; // -> three X (footprint "short" axis)
  const heightM = zCm * UNIT_SCALE; // -> three Y (vertical), registry value

  switch (kind) {
    case "triangleFoundation":
      return triangleFoundationGeo(lenM, thickM, heightM, originAtTop);
    case "triangleWall":
      return triangleWallGeo(lenM, thickM, heightM, false);
    case "triangleWallReverse":
      return triangleWallGeo(lenM, thickM, heightM, true);
    case "diagonalWall":
      // "top edge is a full diagonal, apex at one top corner" — same
      // construction as the triangle walls above.
      return triangleWallGeo(lenM, thickM, heightM, false);
    case "windowWall":
      return wallWithHoleGeo(lenM, thickM, heightM, { wFrac: 0.4, hFrac: 0.4, bottomAligned: false });
    case "doorWall":
      return wallWithHoleGeo(lenM, thickM, heightM, { wFrac: 0.45, hFrac: 0.75, bottomAligned: true });
    case "wallGate":
      return wallWithHoleGeo(lenM, thickM, heightM, { wFrac: 0.7, hFrac: 0.85, bottomAligned: true });
    case "pyramidRoof":
      return pyramidRoofGeo(lenM, thickM);
    case "slantedRoof":
      return slantedRoofGeo(lenM, thickM);
    case "slopedRoofCorner":
      return slopedRoofCornerGeo(lenM, thickM, false);
    case "slopedRoofCornerReverse":
      return slopedRoofCornerGeo(lenM, thickM, true);
    case "stair":
      return stairGeo(lenM, thickM, heightM);
    case "fence":
      return fenceGeo(lenM, thickM, heightM);
    case "ladder":
      return ladderGeo(lenM, thickM, heightM);
    case "box":
    default:
      return boxGeo(lenM, thickM, heightM, originAtTop);
  }
}

/** Plain box, anchored per the convention above (identical world position to the pre-upgrade centered-box + mesh-offset approach). */
function boxGeo(lenM: number, thickM: number, heightM: number, originAtTop: boolean): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(thickM, heightM, lenM);
  geo.translate(0, originAtTop ? -heightM / 2 : heightM / 2, 0);
  return geo;
}

/** Extrude a triangle (given as [x,z] footprint points) vertically between yFrom and yTo. Used for triangleFoundation's footprint. */
function extrudeTriangleY(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  yFrom: number,
  yTo: number,
): THREE.BufferGeometry {
  const A0 = [p0[0], yFrom, p0[1]];
  const B0 = [p1[0], yFrom, p1[1]];
  const C0 = [p2[0], yFrom, p2[1]];
  const A1 = [p0[0], yTo, p0[1]];
  const B1 = [p1[0], yTo, p1[1]];
  const C1 = [p2[0], yTo, p2[1]];
  const tris = [
    A0, C0, B0, // bottom cap
    A1, B1, C1, // top cap
    A0, B0, B1, A0, B1, A1, // side p0-p1
    B0, C0, C1, B0, C1, B1, // side p1-p2
    C0, A0, A1, C0, A1, C1, // side p2-p0
  ];
  return trisToGeometry(tris);
}

/** Extrude a triangle (given as [z,y] cross-section points) along X between xFrom and xTo. Used for the wall-shaped triangle prisms. */
function extrudeTriangleX(
  q0: [number, number],
  q1: [number, number],
  q2: [number, number],
  xFrom: number,
  xTo: number,
): THREE.BufferGeometry {
  const A0 = [xFrom, q0[1], q0[0]];
  const B0 = [xFrom, q1[1], q1[0]];
  const C0 = [xFrom, q2[1], q2[0]];
  const A1 = [xTo, q0[1], q0[0]];
  const B1 = [xTo, q1[1], q1[0]];
  const C1 = [xTo, q2[1], q2[0]];
  const tris = [
    A0, B0, C0, // near cap
    A1, C1, B1, // far cap
    A0, A1, B1, A0, B1, B0, // side q0-q1
    B0, B1, C1, B0, C1, C0, // side q1-q2
    C0, C1, A1, C0, A1, A0, // side q2-q0
  ];
  return trisToGeometry(tris);
}

function trisToGeometry(tris: number[][]): THREE.BufferGeometry {
  const positions = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    positions[i * 3] = tris[i][0];
    positions[i * 3 + 1] = tris[i][1];
    positions[i * 3 + 2] = tris[i][2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Triangular-prism footprint slab: right-triangle footprint (legs = the two footprint extents), extruded vertically by the registry's z (slab thickness), top- or bottom-anchored like a box foundation. */
function triangleFoundationGeo(lenM: number, thickM: number, heightM: number, originAtTop: boolean): THREE.BufferGeometry {
  const hx = thickM / 2;
  const hz = lenM / 2;
  const p0: [number, number] = [-hx, -hz]; // right-angle corner
  const p1: [number, number] = [hx, -hz];
  const p2: [number, number] = [-hx, hz];
  const [yFrom, yTo] = originAtTop ? [-heightM, 0] : [0, heightM];
  return extrudeTriangleY(p0, p1, p2, yFrom, yTo);
}

/**
 * Right-triangle wall prism (gable-filler wall): vertical edge on one side,
 * hypotenuse falling to the other. mirror=false -> vertical edge at -Z
 * ("trianglewall", vertical edge on the naming-implied left);
 * mirror=true -> vertical edge at +Z ("trianglewallreverse").
 */
function triangleWallGeo(lenM: number, thickM: number, heightM: number, mirror: boolean): THREE.BufferGeometry {
  const hz = lenM / 2;
  const hx = thickM / 2;
  const q0: [number, number] = [-hz, 0];
  const q1: [number, number] = [hz, 0];
  const q2: [number, number] = mirror ? [hz, heightM] : [-hz, heightM];
  return extrudeTriangleX(q0, q1, q2, -hx, hx);
}

/** Wall slab with a rectangular cutout (window/door/gate), built as a THREE.Shape + hole, extruded along the thickness axis. */
function wallWithHoleGeo(
  lenM: number,
  thickM: number,
  heightM: number,
  opts: { wFrac: number; hFrac: number; bottomAligned: boolean },
): THREE.BufferGeometry {
  const halfL = lenM / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfL, 0);
  shape.lineTo(halfL, 0);
  shape.lineTo(halfL, heightM);
  shape.lineTo(-halfL, heightM);
  shape.lineTo(-halfL, 0);

  const holeW = lenM * opts.wFrac;
  const holeH = heightM * opts.hFrac;
  const cy = opts.bottomAligned ? holeH / 2 : heightM * 0.55;
  const hx0 = -holeW / 2;
  const hx1 = holeW / 2;
  const hy0 = cy - holeH / 2;
  const hy1 = cy + holeH / 2;
  const hole = new THREE.Path();
  hole.moveTo(hx0, hy0);
  hole.lineTo(hx1, hy0);
  hole.lineTo(hx1, hy1);
  hole.lineTo(hx0, hy1);
  hole.lineTo(hx0, hy0);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickM, bevelEnabled: false, curveSegments: 1 });
  // ExtrudeGeometry extrudes the shape's XY plane along +Z by `depth`; shape.x
  // becomes geometry X (length), shape.y becomes geometry Y (height, already
  // spanning [0,heightM] — bottom-anchored, matching walls' originAtTop=false
  // convention with no extra offset needed), and the extrude axis becomes
  // geometry Z. Center that extrude axis on 0, then swap it onto X (the
  // thickness axis) with a 90° yaw so it lines up with the wall's local
  // frame (three-local X = thickness, three-local Z = length).
  geo.translate(0, 0, -thickM / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** 4-sided pyramid: base = footprint (circumscribed by the cone's circular base), apex height ~150cm regardless of the registry's flat-roof "thickness". */
function pyramidRoofGeo(lenM: number, thickM: number): THREE.BufferGeometry {
  const heightM = 150 * UNIT_SCALE;
  const radius = (Math.max(lenM, thickM) / 2) * Math.SQRT2; // circumscribe the square footprint
  const geo = new THREE.ConeGeometry(radius, heightM, 4, 1);
  geo.rotateY(Math.PI / 4); // a 4-segment cone's vertices sit on the diagonals by default — rotate so its flat faces line up with the grid axes
  geo.translate(0, heightM / 2, 0); // ConeGeometry is Y-centered by default; re-anchor bottom at Y=0
  return geo;
}

/** Wedge roof: ridge along one footprint edge, sloping down to the opposite edge, full footprint width. */
function slantedRoofGeo(lenM: number, thickM: number): THREE.BufferGeometry {
  const heightM = 150 * UNIT_SCALE;
  const hx = thickM / 2;
  const hz = lenM / 2;
  const q0: [number, number] = [-hz, 0];
  const q1: [number, number] = [hz, 0];
  const q2: [number, number] = [hz, heightM];
  return extrudeTriangleX(q0, q1, q2, -hx, hx);
}

/** Quarter-pyramid corner wedge: base = full footprint rectangle, apex directly above one corner (opposite corner for the "reverse" variant). Approximation of the in-game corner roof piece. */
function slopedRoofCornerGeo(lenM: number, thickM: number, reverse: boolean): THREE.BufferGeometry {
  const heightM = 150 * UNIT_SCALE;
  const hx = thickM / 2;
  const hz = lenM / 2;
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const apexIdx = reverse ? 2 : 0; // opposite corners for the two variants
  const base = corners.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const apex = new THREE.Vector3(corners[apexIdx][0], heightM, corners[apexIdx][1]);
  const tris: number[][] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    tris.push([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]);
  pushTri(base[0], base[2], base[1]);
  pushTri(base[0], base[3], base[2]);
  for (let i = 0; i < 4; i++) pushTri(base[i], base[(i + 1) % 4], apex);
  return trisToGeometry(tris);
}

/** Actual steps: 4 boxes of ascending height, merged, rising across the
 *  footprint's "thickness" axis. ASCENT DIRECTION MATTERS: verified in-game
 *  2026-07-18 — the original (+X-rising) version was MIRRORED versus the real
 *  Palworld stair mesh, so users aimed stairs backwards. Steps now rise
 *  toward -X, matching the game. If stairs ever look backwards in-game
 *  again, this sign is the suspect. */
function stairGeo(lenM: number, thickM: number, heightM: number): THREE.BufferGeometry {
  const steps = 4;
  const stepHeight = heightM / steps;
  const stepDepth = thickM / steps;
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < steps; i++) {
    const h = stepHeight * (i + 1);
    const g = new THREE.BoxGeometry(stepDepth, h, lenM);
    g.translate(thickM / 2 - stepDepth * (i + 0.5), h / 2, 0);
    geometries.push(g);
  }
  return mergeGeometries(geometries) ?? geometries[0];
}

/** Low slab plus 3 vertical posts, merged. */
function fenceGeo(lenM: number, thickM: number, heightM: number): THREE.BufferGeometry {
  const slabH = heightM * 0.25;
  const slab = new THREE.BoxGeometry(thickM, slabH, lenM);
  slab.translate(0, slabH / 2, 0);
  const posts = [-0.4, 0, 0.4].map((f) => {
    const g = new THREE.BoxGeometry(thickM, heightM, thickM * 1.2);
    g.translate(0, heightM / 2, lenM * f);
    return g;
  });
  return mergeGeometries([slab, ...posts]) ?? slab;
}

/** Two thin vertical rails + evenly-spaced rungs, merged. */
function ladderGeo(lenM: number, thickM: number, heightM: number): THREE.BufferGeometry {
  const railW = lenM * 0.12;
  const rails = [-1, 1].map((side) => {
    const g = new THREE.BoxGeometry(thickM, heightM, railW);
    g.translate(0, heightM / 2, (side * lenM) / 2 - (side * railW) / 2);
    return g;
  });
  const rungCount = 6;
  const rungs: THREE.BufferGeometry[] = [];
  for (let i = 1; i <= rungCount; i++) {
    const y = (heightM * i) / (rungCount + 1);
    const g = new THREE.BoxGeometry(thickM, heightM * 0.06, Math.max(lenM - railW * 2, lenM * 0.1));
    g.translate(0, y, 0);
    rungs.push(g);
  }
  return mergeGeometries([...rails, ...rungs]) ?? rails[0];
}
