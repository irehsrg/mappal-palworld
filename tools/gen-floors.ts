// Generate the tower's structural floors per the build-guide transcript
// (docs/MEGABASE-PLAN.md): 9 stories — floors at wall-height levels
// 4,8,12,16,20 (stories 1-5, four high), 28,36,44 (stories 6-8, eight high),
// and a glass top cap at 48. Each floor spans the inner 12x12, minus:
//   - the central 2x2 shaft (the four tiles around the palbox intersection)
//   - any tile containing a stair at that level or the level below
//     (the transcript's "2x2 cutout above each of the stairs")
// Existing deck tiles are skipped (position dedup), so hand-built floors
// survive and gaps get topped up. Foundations/floors ONLY — no furniture.
//
// Usage: npx tsx tools/gen-floors.ts <in.json> <out.json> [floorType=Ancient_roof] [capType=Glass_roof]
import { readFileSync, writeFileSync } from "node:fs";
import { loadBlueprint, serializeBlueprint } from "../src/parse/blueprint";
import { extractObjects } from "../src/model/blueprintView";
import { mintGuid, reconcileExport, type DonorLibrary } from "../src/model/writeback";
import { validateLinkage } from "../src/model/validate";
import type { PlacedObject } from "../src/model/types";
import donorsJson from "../src/data/donors.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [inPath, outPath, floorTypeArg, capTypeArg] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: npx tsx tools/gen-floors.ts <in.json> <out.json> [floorType] [capType]");
  process.exit(1);
}
const FLOOR = floorTypeArg ?? "Ancient_roof";
const CAP = capTypeArg ?? "Glass_roof";
const DONORS = (donorsJson as unknown as { donors: DonorLibrary }).donors;
const GRID = 400;
const V = 325;
const FLOOR_LEVELS = [4, 8, 12, 16, 20, 28, 36, 44];
const CAP_LEVEL = 48;

const bp = loadBlueprint(readFileSync(inPath, "utf8"));
const objects = extractObjects(bp.raw);
const palbox = objects.find((o) => o.typeId === "PalBoxV2")!;
const P = palbox.position;
const yaw = 2 * Math.atan2(palbox.rotation.z, palbox.rotation.w);
const f = { x: Math.cos(yaw), y: Math.sin(yaw) };
const r = { x: Math.sin(yaw), y: -Math.cos(yaw) };
const rot = { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };

const posKey = (p: { x: number; y: number; z: number }) =>
  `${Math.round(p.x / 50)},${Math.round(p.y / 50)},${Math.round(p.z / 50)}`;
const existingRoofs = new Set(
  objects
    .filter((o) => {
      const t = o.typeId.toLowerCase();
      return t.includes("roof") || t.includes("foundation");
    })
    .map((o) => posKey(o.position))
);

// Stairs in the palbox frame: any floor tile containing one (at the floor's
// level or one below) stays open so the ascent isn't sealed.
const stairs = objects
  .filter((o) => o.typeId.toLowerCase().includes("stair"))
  .map((o) => {
    const dx = o.position.x - P.x;
    const dy = o.position.y - P.y;
    return {
      df: dx * f.x + dy * f.y,
      dr: dx * r.x + dy * r.y,
      level: Math.round((o.position.z - P.z) / V),
    };
  });

const placed: PlacedObject[] = [];
let skippedExisting = 0;
let cutouts = 0;

const levels = [...FLOOR_LEVELS.map((l) => ({ l, type: FLOOR })), { l: CAP_LEVEL, type: CAP }];
for (const { l, type } of levels) {
  for (let i = -6; i < 6; i++) {
    for (let j = -6; j < 6; j++) {
      const cf = (i + 0.5) * GRID;
      const cr = (j + 0.5) * GRID;
      // central 2x2 shaft stays open all the way up
      if (Math.abs(cf) < GRID && Math.abs(cr) < GRID) continue;
      // stair cutouts: a stair in this tile at level l or l-1 keeps it open
      const blocked = stairs.some(
        (s) =>
          (s.level === l || s.level === l - 1) &&
          Math.abs(s.df - cf) < GRID / 2 &&
          Math.abs(s.dr - cr) < GRID / 2
      );
      if (blocked) {
        cutouts++;
        continue;
      }
      const pos = {
        x: P.x + f.x * cf + r.x * cr,
        y: P.y + f.y * cf + r.y * cr,
        z: P.z + l * V,
      };
      if (existingRoofs.has(posKey(pos))) {
        skippedExisting++;
        continue;
      }
      existingRoofs.add(posKey(pos));
      placed.push({
        id: mintGuid(),
        typeId: type,
        position: pos,
        rotation: { ...rot },
        scale: { x: 1, y: 1, z: 1 },
        origin: "placed",
      });
    }
  }
}

console.log(
  `floors: placed ${placed.length}, skipped ${skippedExisting} existing, ${cutouts} stair cutouts, levels ${levels.map((x) => x.l).join(",")}`
);
const { raw, notes } = reconcileExport(bp.raw, [...objects, ...placed], DONORS);
const lint = validateLinkage(raw);
console.log("lint:", lint.length === 0 ? "clean" : lint.slice(0, 5));
if (lint.length > 0) process.exit(1);
for (const n of notes.slice(-2)) console.log("note:", n);
writeFileSync(outPath, serializeBlueprint({ raw, warnings: [] }));
console.log("wrote", outPath);
