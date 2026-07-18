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
const FACES: Record<string, { out: { x: number; y: number }; lat: { x: number; y: number }; yawOff: number }> = {
  north: { out: { x: f.x, y: f.y }, lat: { x: r.x, y: r.y }, yawOff: 180 },
  south: { out: { x: -f.x, y: -f.y }, lat: { x: -r.x, y: -r.y }, yawOff: 0 },
  east: { out: { x: r.x, y: r.y }, lat: { x: f.x, y: f.y }, yawOff: 90 },
  west: { out: { x: -r.x, y: -r.y }, lat: { x: -f.x, y: -f.y }, yawOff: 270 },
};

// Dedup against walls already in the file (e.g. hand-placed glass ring rows).
const existing = new Set(
  objects
    .filter((o) => o.typeId.toLowerCase().includes("wall"))
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
