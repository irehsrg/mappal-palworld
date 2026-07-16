// Generate gray-box registry entries (src/data/objects.json) for every donor
// type that doesn't have one yet, using the game's naming convention mapped
// onto our MEASURED grid numbers (docs/CALIBRATION.md: pitch 400, wall 325).
//
// These are DISPLAY dimensions only — they never touch blueprint data, so
// estimating here is safe (C4 governs schema fields, not our own gray boxes).
// Existing entries are never overwritten; hand-tuned values always win.
// Production furniture gets dimensions from its donor's works bounds where
// available (workable_bounds.box_extent doubled — the trick from calibration).
//
// Usage: npx tsx tools/gen-object-registry.ts
import { readFileSync, writeFileSync } from "node:fs";

/* eslint-disable @typescript-eslint/no-explicit-any */
const donorsFile = JSON.parse(readFileSync("src/data/donors.json", "utf8"));
const registry = JSON.parse(readFileSync("src/data/objects.json", "utf8"));

const GRID = registry.gridPitch ?? 400;
const WALL_H = registry.verticalPitch ?? 325;

function displayName(typeId: string): string {
  return typeId
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Naming-convention rules, most specific first. Sizes are [x, y, z] full extents in cm. */
function classify(typeId: string, donor: any): { category: string; size: (number | null)[]; sizeSource: string; originAtTop?: boolean } | null {
  const t = typeId.toLowerCase();
  const rule = (category: string, size: (number | null)[], extra?: { originAtTop?: boolean }) => ({
    category,
    size,
    sizeSource: "estimated from naming convention + measured grid (docs/CALIBRATION.md) — display only, refine visually",
    ...extra,
  });

  if (t.includes("foundation")) return rule("structure", [GRID, GRID, 40], { originAtTop: true });
  if (t.includes("pillar")) return rule("structure", [40, 40, WALL_H]);
  if (t.includes("wallgate")) return rule("structure", [GRID, 30, WALL_H]);
  if (t.includes("wall")) return rule("structure", [GRID, 20, WALL_H]);
  if (t.includes("fence")) return rule("defense", [GRID, 20, 110]);
  if (t.includes("ladder")) return rule("structure", [40, 20, WALL_H]);
  if (t.includes("stair")) return rule("structure", [GRID, GRID, WALL_H]);
  if (t.includes("roof")) return rule("structure", [GRID, GRID, 30]);
  // Pal beds: MedicalPalBed_02's measured bounds were 360x360x100; assume the
  // family matches. Player beds are visibly smaller — rough eyeball.
  if (t.includes("palbed")) return rule("decor", [360, 360, 100]);
  if (t.includes("bed")) return rule("decor", [200, 120, 60]);

  // Production/furniture: prefer real bounds from the donor's works entry.
  const be = donor?.works?.[0]?.RawData?.value?.workable_bounds?.box_sphere_bounds?.box_extent;
  const size =
    be && [be.x, be.y, be.z].every((v: unknown) => typeof v === "number" && (v as number) > 0)
      ? [be.x * 2, be.y * 2, be.z * 2]
      : [null, null, null];
  const src = size[0]
    ? "works[].workable_bounds.box_extent doubled — interaction volume, slightly padded"
    : "no rule matched and no works bounds — magenta until measured";
  const PRODUCTION_HINTS = [
    "bench", "factory", "furnace", "pit", "crusher", "mill", "pump",
    "station", "facility", "pond", "campfire", "multiproduct", "desk",
  ];
  if (PRODUCTION_HINTS.some((h) => t.includes(h))) {
    return { category: "production", size, sizeSource: src };
  }
  return size[0] ? { category: "decor", size, sizeSource: src } : null;
}

let added = 0;
for (const [typeId, donor] of Object.entries<any>(donorsFile.donors)) {
  if (registry.types[typeId]) continue; // hand-tuned entries always win
  const c = classify(typeId, donor);
  if (!c) {
    console.log(`no rule for ${typeId} — stays magenta`);
    continue;
  }
  registry.types[typeId] = { name: displayName(typeId), ...c };
  console.log(`added ${typeId}: ${c.category} [${c.size.join(", ")}]`);
  added++;
}

writeFileSync("src/data/objects.json", JSON.stringify(registry, null, 2));
console.log(`\nadded ${added} entries; registry now has ${Object.keys(registry.types).length} types`);
