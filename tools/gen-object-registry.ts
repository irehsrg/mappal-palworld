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

// Curated internal-id -> in-game display names, confirmed against the v1.0
// build menu (Alex, 2026-07-19). Generator-applied so regens keep them.
const DISPLAY_NAMES: Record<string, string> = {
  MedicalPalBed_02: "Straw Pal Bed",
  MedicalPalBed_03: "Fluffy Pal Bed",
  MedicalPalBed_04: "Large Pal Bed",
  MedicalPalBed_05: "Pal Pod",
  Ancient_MedicalPalBed: "Ancient Pal Bed",
  PlayerBed_02: "Shoddy Bed",
  PlayerBed_03: "Fine Bed",
  IceCrusher: "Cryogenic Crusher",
  MonsterFarm: "Ranch",
  SkinChange: "Pal Dressing Facility",
  DisplayCharacter: "Viewing Cage",
  GlobalPalStorage: "Global Palbox",
  OperatingTable: "Pal Surgery Table",
  MultiElectricHatchingPalEggWithBreed: "Breeding Farm",
  DismantlingConveyor: "Pal Disassembly Conveyor",
  Farm_SkillFruits: "Skillfruit Orchard",
  AncientFarmBlock: "Ancient Farm",
  HugeKitchen: "Large-Scale Stone Oven",
  CookingStove: "Cooking Pot",
  AncientCookingStove: "Ancient Kitchen",
  PalMedicineBox: "Medicine Rack",
  PalFoodBox: "Feed Box",
  CoolerPalFoodBox: "Cold Food Box",
  EnergyStorage_Electric: "Accumulator",
  ElectricGenerator: "Power Generator",
  ManualElectricGenerator: "Human-Powered Generator",
  ElectricGenerator_Large: "Large Power Generator",
  AncientElectricGenerator: "Ancient Power Generator",
  Spa: "Hot Spring",
  Spa2: "High Quality Hot Spring",
  Spa3: "Japanese-Style Hot Spring",
  Ancient_Spa: "Ancient Hot Spring",
  StationDeforest2: "Logging Site",
  StationDeforest3: "Logging Site II",
  Headstone: "Tombstone",
  Altar: "Summoning Altar",
  Factory_Money: "Gold Coin Assembly Line",
  CompositeDesk: "Drafting Table",
  WorkSpeedIncrease1: "Alpha Wave Generator",
  SanityDecrease1: "Beta Wave Generator",
  WorkBench_SkillUnlock: "Pal Gear Workbench",
  AncientMultiProduct: "Ancient Material Synthesizer",
  AncientRelicRecycler: "Ancient Relic Recycler",
  BaseCampWorkHard: "Monitoring Stand",
  Lab: "Pal Labor Research Lab",
  BuildableGoddessStatue: "Statue of Power",
  CharacterRankUp: "Essence Condenser",
  Expedition: "Expedition Cage",
};

function displayName(typeId: string): string {
  if (DISPLAY_NAMES[typeId]) return DISPLAY_NAMES[typeId];
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
  const STORAGE_HINTS = [
    "shelf", "chest", "box", "container", "barrel", "tansu", "cask", "storage",
  ];
  if (STORAGE_HINTS.some((h) => t.includes(h))) {
    return {
      category: "storage",
      size: size[0] ? size : [200, 100, 180],
      sizeSource: size[0] ? src : "rough storage-furniture estimate — display only",
    };
  }
  const PRODUCTION_HINTS = [
    "bench", "factory", "furnace", "pit", "crusher", "mill", "pump",
    "station", "facility", "pond", "campfire", "multiproduct", "desk",
    "conveyor", "stove", "hatch", "lab", "operating", "basecampwork",
  ];
  if (PRODUCTION_HINTS.some((h) => t.includes(h))) {
    return { category: "production", size, sizeSource: src };
  }
  const SPECIAL_HINTS = [
    "altar", "statue", "expedition", "rankup", "skinchange",
    "displaycharacter", "goddess",
  ];
  if (SPECIAL_HINTS.some((h) => t.includes(h))) {
    return { category: "decor", size, sizeSource: src };
  }

  // Decor/furniture families (sampler_03). All sizes are rough display
  // estimates; bounds win when a donor has them.
  const est = (category: string, s: (number | null)[]) => ({
    category,
    size: size[0] ? size : s,
    sizeSource: size[0] ? src : "rough furniture estimate — display only",
  });
  if (t.startsWith("trap")) return est("defense", [150, 150, 40]);
  // Large freestanding base gates (Wood_Gate/Stone_Gate/Metal_Gate) — much
  // bigger than the wall-mounted WallGate handled above.
  if (t.endsWith("_gate") || t === "gate") return est("defense", [800, 60, 500]);
  if (t.includes("furnituretree") || t.includes("bonsai")) return est("decor", [150, 150, 300]);
  if (t.includes("furniturebush") || t.includes("plant")) return est("decor", [120, 120, 100]);
  if (t.includes("light") || t.includes("lamp") || t.includes("torch") || t.includes("andon"))
    return est("decor", [60, 60, 220]);
  if (t.includes("rug")) return est("decor", [200, 200, 5]);
  if (t.includes("sofa") || t.includes("counter")) return est("decor", [220, 100, 100]);
  if (t.includes("table") || t.includes("fudukue") || t.includes("seika"))
    return est("decor", [200, 200, 90]);
  if (t.includes("chair") || t.includes("stool") || t.includes("zabuton") || t.includes("zaisu"))
    return est("decor", [100, 100, 100]);
  if (t.includes("spa")) return est("production", [300, 300, 150]);
  if (t.includes("signboard") || t.includes("headstone") || t.includes("scarecrow"))
    return est("decor", [100, 40, 150]);

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
