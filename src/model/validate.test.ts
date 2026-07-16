// Export lint: clean files pass; each documented breakage pattern is caught.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBlueprint } from "../parse/blueprint";
import { extractObjects } from "./blueprintView";
import { mintGuid, reconcileExport, type DonorLibrary } from "./writeback";
import { validateLinkage } from "./validate";
import donorsJson from "../data/donors.json";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");
const DONORS = (donorsJson as unknown as { donors: DonorLibrary }).donors;

function freshRaw(): any {
  return JSON.parse(FIXTURE);
}

describe("validateLinkage", () => {
  it("passes the untouched fixture", () => {
    expect(validateLinkage(freshRaw())).toEqual([]);
  });

  it("passes a full editor pipeline output (move + duplicate + place)", () => {
    const bp = loadBlueprint(FIXTURE);
    const objects = extractObjects(bp.raw);
    const moved = objects.map((o, i) =>
      i === 0 ? { ...o, position: { ...o.position, x: o.position.x + 400 } } : o
    );
    const chest = objects.find((o) => o.typeId === "ItemChest")!;
    const dup = {
      ...chest,
      id: mintGuid(),
      origin: "duplicate" as const,
      sourceId: chest.id,
      position: { ...chest.position, x: chest.position.x + 400 },
    };
    const placed = {
      id: mintGuid(),
      typeId: "Stone_Foundation",
      position: { x: -350000, y: 268000, z: 7139.69 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      origin: "placed" as const,
    };
    const { raw } = reconcileExport(bp.raw, [...moved, dup, placed], DONORS);
    expect(validateLinkage(raw)).toEqual([]);
  });

  it("catches a dangling repair_work_id", () => {
    const raw = freshRaw();
    raw.works.pop(); // remove some object's work entry
    const warnings = validateLinkage(raw);
    expect(warnings.some((w) => w.includes("has no works entry"))).toBe(true);
  });

  it("catches a missing item container", () => {
    const raw = freshRaw();
    raw.item_containers = raw.item_containers.slice(0, 1);
    const warnings = validateLinkage(raw);
    expect(warnings.some((w) => w.includes("missing from item_containers"))).toBe(true);
  });

  it("catches works bound to a foreign base camp (the structure-purge pattern)", () => {
    const raw = freshRaw();
    raw.works[0].RawData.value.base_camp_id_belong_to = mintGuid();
    const warnings = validateLinkage(raw);
    expect(warnings.some((w) => w.includes("different base camp"))).toBe(true);
  });

  it("catches duplicate model instance ids (the palbox-reuse pattern)", () => {
    const raw = freshRaw();
    const clone = JSON.parse(JSON.stringify(raw.map_objects[0]));
    raw.map_objects.push(clone);
    const warnings = validateLinkage(raw);
    expect(warnings.some((w) => w.includes("duplicate model instance_id"))).toBe(true);
  });
});
