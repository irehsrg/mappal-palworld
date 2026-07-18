// Generate the tower's outer wall shells from a plan matrix extracted from
// the build-guide graphic (see scratchpad extract_plan.py): per face, a grid
// of cells — "G" = glass wall on the inner ring (12x12 edge, offset 2400
// from the palbox), "B" = SF/clean wall on the outer ring (14x14 edge,
// offset 2800), "." = nothing. Level 0 = platform top; z = palboxZ + L*325.
//
// Usage: npx tsx tools/gen-cladding.ts <in.json> <plan_faces.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { loadBlueprint, serializeBlueprint } from "../src/parse/blueprint";
import { extractObjects } from "../src/model/blueprintView";
import { mintGuid, reconcileExport, type DonorLibrary } from "../src/model/writeback";
import { validateLinkage } from "../src/model/validate";
import type { PlacedObject } from "../src/model/types";
import donorsJson from "../src/data/donors.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [inPath, planPath, outPath] = process.argv.slice(2);
if (!inPath || !planPath || !outPath) {
  console.error("usage: npx tsx tools/gen-cladding.ts <in.json> <plan_faces.json> <out.json>");
  process.exit(1);
}

const DONORS = (donorsJson as unknown as { donors: DonorLibrary }).donors;
const GRID = 400;
const V = 325;
const GLASS_OFFSET = 6 * GRID; // inner 12x12 ring edge
const SF_OFFSET = 7 * GRID; // outer 14x14 ring edge

const bp = loadBlueprint(readFileSync(inPath, "utf8"));
const objects = extractObjects(bp.raw);
const palbox = objects.find((o) => o.typeId === "PalBoxV2");
if (!palbox) throw new Error("no palbox in input");
const P = palbox.position;
const yaw = 2 * Math.atan2(palbox.rotation.z, palbox.rotation.w);
const f = { x: Math.cos(yaw), y: Math.sin(yaw) }; // forward (matches scene coords.ts)
const r = { x: Math.sin(yaw), y: -Math.cos(yaw) }; // right

const qz = (deg: number) => {
  const h = ((yaw + (deg * Math.PI) / 180) / 2);
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
};

// face -> outward axis (unit), lateral axis for increasing column, wall yaw offset (deg)
// Lateral axes carry the plan's viewed-from-OUTSIDE column order. The rule
// that makes corners pair (face A's RIGHT edge meets face B's LEFT edge when
// walking around the building) is a clockwise walk viewed from above:
//   north: cols run +r   east: cols run -f   south: cols run -r   west: +f
// The first attempt wound east/west the other way and adjacent faces' corner
// spike columns landed apart instead of back-to-back (user-verified
// 2026-07-18).
const FACES: Record<string, { out: { x: number; y: number }; lat: { x: number; y: number }; yawOff: number }> = {
  north: { out: { x: f.x, y: f.y }, lat: { x: r.x, y: r.y }, yawOff: 180 },
  south: { out: { x: -f.x, y: -f.y }, lat: { x: -r.x, y: -r.y }, yawOff: 0 },
  east: { out: { x: r.x, y: r.y }, lat: { x: -f.x, y: -f.y }, yawOff: 90 },
  west: { out: { x: -r.x, y: -r.y }, lat: { x: f.x, y: f.y }, yawOff: 270 },
};

// Dedup against walls/roofs already in the file (hand-placed rows, reruns).
const existing = new Set(
  objects
    .filter((o) => {
      const t = o.typeId.toLowerCase();
      return t.includes("wall") || t.includes("roof");
    })
    .map((o) => `${Math.round(o.position.x / 50)},${Math.round(o.position.y / 50)},${Math.round(o.position.z / 50)}`)
);

const plan: Record<string, string[][]> = JSON.parse(readFileSync(planPath, "utf8"));
const placed: PlacedObject[] = [];
const counts: Record<string, { glass: number; sf: number; skipped: number }> = {};

for (const [face, def] of Object.entries(FACES)) {
  const grid = plan[face];
  if (!grid) throw new Error(`plan missing face ${face}`);
  const c = { glass: 0, sf: 0, skipped: 0 };
  for (let level = 0; level < grid.length; level++) {
    for (let col = 0; col < grid[level].length; col++) {
      const cell = grid[level][col];
      if (cell !== "G" && cell !== "B") continue;
      const off = cell === "G" ? GLASS_OFFSET : SF_OFFSET;
      const typeId = cell === "G" ? "Glass_wall" : "SF_wall";
      const lat = (col - 6.5) * GRID;
      const pos = {
        x: P.x + def.out.x * off + def.lat.x * lat,
        y: P.y + def.out.y * off + def.lat.y * lat,
        z: P.z + level * V,
      };
      const key = `${Math.round(pos.x / 50)},${Math.round(pos.y / 50)},${Math.round(pos.z / 50)}`;
      if (existing.has(key)) {
        c.skipped++;
        continue;
      }
      existing.add(key);
      placed.push({
        id: mintGuid(),
        typeId,
        position: pos,
        rotation: qz(def.yawOff),
        scale: { x: 1, y: 1, z: 1 },
        origin: "placed",
      });
      if (cell === "G") c.glass++;
      else c.sf++;
    }
  }
  counts[face] = c;

  // --- connectors tying the cladding back to the glass shell -------------
  // 1. RETURN WALLS: at every interior horizontal end of a cladding run, a
  //    perpendicular SF wall bridges the one-tile gap (out 2400 -> 2800),
  //    i.e. an edge-lattice wall centered at out=2600 on the run's boundary.
  //    Ends that reach the face boundary (col 0 / col 13) pair into corners
  //    with the adjacent face and need no return.
  // 2. GAP CAPS: at the top of every vertical cladding run, a Glass_roof
  //    tile covers the gap (centered between the shells); floating run
  //    bottoms get a floor tile the same way (skip level 0 — the platform).
  const RETURN_OFF = 6.5 * GRID; // 2600, midpoint between the shells
  let returns = 0;
  let caps = 0;
  const place = (typeId: string, ox: number, lx: number, z: number, yawDeg: number) => {
    const pos = {
      x: P.x + def.out.x * ox + def.lat.x * lx,
      y: P.y + def.out.y * ox + def.lat.y * lx,
      z,
    };
    const key = `${Math.round(pos.x / 50)},${Math.round(pos.y / 50)},${Math.round(pos.z / 50)}`;
    if (existing.has(key)) return false;
    existing.add(key);
    placed.push({
      id: mintGuid(),
      typeId,
      position: pos,
      rotation: qz(yawDeg),
      scale: { x: 1, y: 1, z: 1 },
      origin: "placed",
    });
    return true;
  };

  for (let level = 0; level < grid.length; level++) {
    let runStart: number | null = null;
    for (let col = 0; col <= grid[level].length; col++) {
      const isB = col < grid[level].length && grid[level][col] === "B";
      if (isB && runStart === null) runStart = col;
      if (!isB && runStart !== null) {
        const runEnd = col - 1;
        const z = P.z + level * V;
        if (runStart > 0 && place("SF_wall", RETURN_OFF, (runStart - 7) * GRID, z, def.yawOff + 90)) returns++;
        if (runEnd < grid[level].length - 1 && place("SF_wall", RETURN_OFF, (runEnd - 6) * GRID, z, def.yawOff + 90)) returns++;
        runStart = null;
      }
    }
  }
  const nCols = grid[0].length;
  for (let col = 0; col < nCols; col++) {
    let runBottom: number | null = null;
    for (let level = 0; level <= grid.length; level++) {
      const isB = level < grid.length && grid[level][col] === "B";
      if (isB && runBottom === null) runBottom = level;
      if (!isB && runBottom !== null) {
        const lat = (col - 6.5) * GRID;
        if (place("Glass_roof", RETURN_OFF, lat, P.z + level * V, 0)) caps++;
        if (runBottom > 0 && place("Glass_roof", RETURN_OFF, lat, P.z + runBottom * V, 0)) caps++;
        runBottom = null;
      }
    }
  }
  (counts[face] as any).returns = returns;
  (counts[face] as any).caps = caps;
}

console.log("per-face:", JSON.stringify(counts, null, 1));
console.log("total new walls:", placed.length);

const { raw, notes } = reconcileExport(bp.raw, [...objects, ...placed], DONORS);
const lint = validateLinkage(raw);
console.log("lint:", lint.length === 0 ? "clean" : lint);
if (lint.length > 0) process.exit(1);
for (const n of notes.slice(-3)) console.log("note:", n);
writeFileSync(outPath, serializeBlueprint({ raw, warnings: [] }));
console.log("wrote", outPath);
