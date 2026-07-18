// Phase 2 palette placement: donor-cloned objects must land in the export as
// complete, consistent bundles — and placement must never corrupt the rest of
// the file (CLAUDE.md C5, §6).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBlueprint, serializeBlueprint } from "../parse/blueprint";
import { extractObjects } from "./blueprintView";
import { mintGuid, reconcileExport, type DonorLibrary } from "./writeback";
import donorsJson from "../data/donors.json";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");
const DONORS = (donorsJson as unknown as { donors: DonorLibrary }).donors;

const POS = { x: -350000, y: 268000, z: 7139.69 };
const ROT = { x: 0, y: 0, z: 0, w: 1 };

function placeOne(typeId: string) {
  const bp = loadBlueprint(FIXTURE);
  const objects = extractObjects(bp.raw);
  const placed = {
    id: mintGuid(),
    typeId,
    position: POS,
    rotation: ROT,
    scale: { x: 1, y: 1, z: 1 },
    origin: "placed" as const,
  };
  const before = JSON.parse(FIXTURE);
  const { raw } = reconcileExport(bp.raw, [...objects, placed], DONORS);
  const after = JSON.parse(serializeBlueprint({ raw, warnings: [] }));
  return { before, after, placedId: placed.id };
}

describe("palette placement (donor pattern)", () => {
  it("places a wall as a complete, consistent bundle", () => {
    const { before, after, placedId } = placeOne("Wooden_wall");

    expect(after.map_objects).toHaveLength(before.map_objects.length + 1);
    const added = after.map_objects[after.map_objects.length - 1];
    expect(added.MapObjectId.value).toBe("Wooden_wall");

    const rd = added.Model.value.RawData.value;
    expect(rd.instance_id).toBe(placedId);
    // Fresh ids, not colliding with anything in the source file.
    const originalIds = new Set(
      before.map_objects.map((m: any) => m.Model.value.RawData.value.instance_id)
    );
    expect(originalIds.has(rd.instance_id)).toBe(false);
    // Structural pieces have NO concrete model: the zero GUID and an opaque
    // ConcreteModel blob must be preserved verbatim, never invented (C4).
    const crd = added.ConcreteModel.value.RawData.value;
    expect(rd.concrete_model_instance_id).toBe("00000000-0000-0000-0000-000000000000");
    expect(crd.instance_id).toBeUndefined();
    expect(crd.model_instance_id).toBeUndefined();
    // Membership rewritten to THIS file's camp and guild.
    expect(rd.base_camp_id_belong_to).toBe(before.base_camp.key);
    expect(rd.group_id_belong_to).toBe(
      before.base_camp.value.RawData.value.group_id_belong_to
    );
    // Transform applied.
    expect(rd.initital_transform_cache.translation).toEqual(POS);
    // Stands alone: no inherited attachment links.
    const connect = added.Model.value.Connector.value.RawData.value.connect;
    expect(connect.any_place).toEqual([]);
    // Its repair work came along, owned by the new id, on this file's camp.
    const work = after.works.find(
      (w: any) => w.RawData.value.id === rd.repair_work_id
    );
    expect(work).toBeDefined();
    expect(work.RawData.value.owner_map_object_model_id).toBe(placedId);
    expect(work.RawData.value.base_camp_id_belong_to).toBe(before.base_camp.key);
    expect(after.works).toHaveLength(before.works.length + 1);
  });

  it("places a chest with a fresh inventory container", () => {
    const { before, after, placedId } = placeOne("ItemChest");
    expect(after.item_containers).toHaveLength(before.item_containers.length + 1);
    const added = after.map_objects[after.map_objects.length - 1];
    // Smart objects DO have a concrete model — cross-refs must be reminted consistently.
    const rd = added.Model.value.RawData.value;
    const crd = added.ConcreteModel.value.RawData.value;
    expect(crd.model_instance_id).toBe(placedId);
    expect(crd.instance_id).toBe(rd.concrete_model_instance_id);
    expect(rd.concrete_model_instance_id).not.toBe("00000000-0000-0000-0000-000000000000");
    const mod = added.ConcreteModel.value.ModuleMap.value.find((m: any) =>
      String(m.key).includes("ItemContainer")
    );
    const cid = mod.value.RawData.value.target_container_id;
    // Container id is fresh and its entry exists.
    expect(
      before.item_containers.some((c: any) => c.key.ID.value === cid)
    ).toBe(false);
    expect(
      after.item_containers.some((c: any) => c.key.ID.value === cid)
    ).toBe(true);
  });

  it("does not disturb anything else in the file", () => {
    const { before, after } = placeOne("Wooden_foundation");
    // Everything pre-existing is byte-identical: compare with the addition removed.
    const trimmed = {
      ...after,
      map_objects: after.map_objects.slice(0, before.map_objects.length),
      works: after.works.slice(0, before.works.length),
    };
    expect(trimmed).toEqual(before);
  });

  it("exports duplicates of palette-placed pieces (the column-stacking flow)", () => {
    // Regression: Ctrl+D on a placed piece used to create a broken
    // origin:"duplicate" with no sourceId, making export throw.
    const bp = loadBlueprint(FIXTURE);
    const objects = extractObjects(bp.raw);
    const placed = {
      id: mintGuid(),
      typeId: "Wooden_pillar",
      position: POS,
      rotation: ROT,
      scale: { x: 1, y: 1, z: 1 },
      origin: "placed" as const,
    };
    // what duplicateSelection now produces for a placed source:
    const copy = { ...placed, id: mintGuid(), sourceId: undefined, position: { ...POS, z: POS.z + 325 } };
    const before = JSON.parse(FIXTURE);
    const { raw } = reconcileExport(bp.raw, [...objects, placed, copy], DONORS);
    const after = JSON.parse(serializeBlueprint({ raw, warnings: [] }));
    expect(after.map_objects).toHaveLength(before.map_objects.length + 2);
    const added = after.map_objects.slice(-2);
    expect(added.map((m: any) => m.MapObjectId.value)).toEqual(["Wooden_pillar", "Wooden_pillar"]);
    const ids = added.map((m: any) => m.Model.value.RawData.value.instance_id);
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses to place a palbox or an unknown type", () => {
    const bp = loadBlueprint(FIXTURE);
    const objects = extractObjects(bp.raw);
    const mk = (typeId: string) => ({
      id: mintGuid(),
      typeId,
      position: POS,
      rotation: ROT,
      scale: { x: 1, y: 1, z: 1 },
      origin: "placed" as const,
    });
    expect(() =>
      reconcileExport(bp.raw, [...objects, mk("PalBoxV2")], DONORS)
    ).toThrow(/cannot be palette-placed/);
    expect(() =>
      reconcileExport(bp.raw, [...objects, mk("Totally_Made_Up")], DONORS)
    ).toThrow(/no donor bundle/);
  });
});
