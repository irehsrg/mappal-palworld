// Tests for the export-time reconciliation layer (src/model/writeback.ts).
//
// CLAUDE.md C5 ("round-trip fidelity is the top priority") and the working
// agreement "every destructive path gets a test, especially delete and
// duplicate" are exercised here against the REAL calibration fixture
// (fixtures/calibration_01.json), using the specific object documented in
// docs/CALIBRATION.md's linkage section:
//
//   - c0faba7d-4197-ff54-3152-51b4a7a83d98 — the ItemChest. It carries one
//     ConcreteModel.ModuleMap entry of type ...ModuleType::ItemContainer
//     (target_container_id 9d5ce9b7-425c-df99-89bd-ff96feddb005, verified
//     against item_containers[].key.ID.value in the fixture) and a
//     repair_work_id of 1aafe05c-494c-33e0-cbf7-b89e8c6b6119 (verified
//     against works[].RawData.value.id in the fixture).
//   - 0dc348e9-4e5e-9dd5-8ee9-50bb3297c329 — the host foundation. Its
//     Model.Connector.RawData.value.connect.any_place carries a bidirectional
//     link to the chest (and the chest links back), per SCHEMA.md's Connector
//     description.
//
// All schema field names referenced below were either lifted from
// docs/SCHEMA.md or independently confirmed against the fixture with a
// throwaway node script before writing these tests (CLAUDE.md C4).

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBlueprint, serializeBlueprint } from "../parse/blueprint";
import { extractObjects } from "./blueprintView";
import { reconcileExport, mintGuid } from "./writeback";
import type { PlacedObject } from "./types";
import { deepDiff } from "../test-utils/deepDiff";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/calibration_01.json");
const fixtureExists = existsSync(fixturePath);

const CHEST_ID = "c0faba7d-4197-ff54-3152-51b4a7a83d98";
const CHEST_CONTAINER_ID = "9d5ce9b7-425c-df99-89bd-ff96feddb005";
const CHEST_REPAIR_WORK_ID = "1aafe05c-494c-33e0-cbf7-b89e8c6b6119";
const HOST_FOUNDATION_ID = "0dc348e9-4e5e-9dd5-8ee9-50bb3297c329";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe.skipIf(!fixtureExists)(
  "writeback (fixtures/calibration_01.json)",
  () => {
    test("no-edit export is identical: zero diff paths, including negative-zero sign bit", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const originalParsed: Any = JSON.parse(originalText);

      const loaded = loadBlueprint(originalText);
      const objects = extractObjects(loaded.raw);
      const { raw: exportedRaw } = reconcileExport(loaded.raw, objects);
      const reserializedText = serializeBlueprint({ raw: exportedRaw, warnings: [] });
      const reparsed: Any = JSON.parse(reserializedText);

      const diffs = deepDiff(originalParsed, reparsed);
      expect(diffs).toEqual([]);

      // Spot-check the sign bit explicitly at a known -0 location (verified
      // directly in the fixture — base_camp's fast_travel_local_transform.
      // rotation.y is -0.0 in the source file), so this test fails loudly
      // and specifically if -0 handling ever regresses, not just generically
      // via the diff list above.
      const originalY = originalParsed.base_camp.value.RawData.value
        .fast_travel_local_transform.rotation.y;
      expect(Object.is(originalY, -0)).toBe(true); // guards the guard
      const reparsedY = reparsed.base_camp.value.RawData.value
        .fast_travel_local_transform.rotation.y;
      expect(Object.is(reparsedY, -0)).toBe(true);
    });

    test("moving one object only touches that object's translation — nothing else, including its own rotation", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const originalParsed: Any = JSON.parse(originalText);

      const loaded = loadBlueprint(originalText);
      const objects = extractObjects(loaded.raw);
      const target = objects.find((o) => o.id === HOST_FOUNDATION_ID);
      expect(target).toBeDefined();

      const moved = objects.map((o) =>
        o.id === HOST_FOUNDATION_ID
          ? { ...o, position: { ...o.position, x: o.position.x + 400 } }
          : o,
      );

      const { raw: exportedRaw } = reconcileExport(loaded.raw, moved);
      const reparsed: Any = JSON.parse(
        serializeBlueprint({ raw: exportedRaw, warnings: [] }),
      );

      const diffs = deepDiff(originalParsed, reparsed);

      const index = originalParsed.map_objects.findIndex(
        (mo: Any) => mo.Model.value.RawData.value.instance_id === HOST_FOUNDATION_ID,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const expectedPath = `$.map_objects[${index}].Model.value.RawData.value.initital_transform_cache.translation.x`;

      // Exact path count: ONE changed path, and it's the translation.x of
      // the moved object. Nothing under rotation (or y/z translation, or any
      // other object) changed.
      expect(diffs).toEqual([expectedPath]);

      // And the actual value is old + 400.
      const oldX =
        originalParsed.map_objects[index].Model.value.RawData.value
          .initital_transform_cache.translation.x;
      const newX =
        reparsed.map_objects[index].Model.value.RawData.value
          .initital_transform_cache.translation.x;
      expect(newX).toBeCloseTo(oldX + 400, 6);
    });

    test("deleting the chest removes its work, its container, and the host's connector link — bounded diff", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const originalParsed: Any = JSON.parse(originalText);

      const loaded = loadBlueprint(originalText);
      const objects = extractObjects(loaded.raw);
      const remaining = objects.filter((o) => o.id !== CHEST_ID);
      expect(remaining.length).toBe(objects.length - 1);

      const { raw: exportedRaw, notes } = reconcileExport(loaded.raw, remaining);
      const reparsed: Any = JSON.parse(
        serializeBlueprint({ raw: exportedRaw, warnings: [] }),
      );

      // map_objects shrank by exactly 1, and the chest is gone.
      expect(reparsed.map_objects.length).toBe(
        originalParsed.map_objects.length - 1,
      );
      expect(
        reparsed.map_objects.some(
          (mo: Any) => mo.Model.value.RawData.value.instance_id === CHEST_ID,
        ),
      ).toBe(false);

      // The chest's repair work is gone.
      expect(
        reparsed.works.some(
          (w: Any) => w.RawData.value.id === CHEST_REPAIR_WORK_ID,
        ),
      ).toBe(false);

      // The chest's item container is gone.
      expect(
        reparsed.item_containers.some(
          (c: Any) => c.key.ID.value === CHEST_CONTAINER_ID,
        ),
      ).toBe(false);

      // The host foundation's Connector no longer references the chest.
      const host = reparsed.map_objects.find(
        (mo: Any) => mo.Model.value.RawData.value.instance_id === HOST_FOUNDATION_ID,
      );
      expect(host).toBeDefined();
      const anyPlace =
        host.Model.value.Connector.value.RawData.value.connect.any_place;
      expect(
        anyPlace.some(
          (l: Any) => l.connect_to_model_instance_id === CHEST_ID,
        ),
      ).toBe(false);

      // Bounded diff: hand-build the expected file independently of
      // writeback's own logic (plain array filters + one connector strip)
      // and assert there is NOTHING ELSE different anywhere in the tree.
      const expected: Any = structuredClone(originalParsed);
      expected.map_objects = expected.map_objects.filter(
        (mo: Any) => mo.Model.value.RawData.value.instance_id !== CHEST_ID,
      );
      expected.works = expected.works.filter(
        (w: Any) => w.RawData.value.id !== CHEST_REPAIR_WORK_ID,
      );
      expected.item_containers = expected.item_containers.filter(
        (c: Any) => c.key.ID.value !== CHEST_CONTAINER_ID,
      );
      const expectedHost = expected.map_objects.find(
        (mo: Any) => mo.Model.value.RawData.value.instance_id === HOST_FOUNDATION_ID,
      );
      expectedHost.Model.value.Connector.value.RawData.value.connect.any_place =
        expectedHost.Model.value.Connector.value.RawData.value.connect.any_place.filter(
          (l: Any) => l.connect_to_model_instance_id !== CHEST_ID,
        );

      const diffs = deepDiff(expected, reparsed);
      expect(diffs).toEqual([]);

      expect(notes.some((n) => /deleted 1 object/.test(n))).toBe(true);
    });

    test("duplicating the chest mints a consistent bundle and leaves the original byte-identical", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const loaded = loadBlueprint(originalText);
      const objects = extractObjects(loaded.raw);
      const chest = objects.find((o) => o.id === CHEST_ID);
      expect(chest).toBeDefined();

      const rawBefore = loaded.raw as Any;
      const beforeMoCount = rawBefore.map_objects.length;
      const originalMoSnapshot = structuredClone(
        rawBefore.map_objects.find(
          (mo: Any) => mo.Model.value.RawData.value.instance_id === CHEST_ID,
        ),
      );
      const originalWorkSnapshot = structuredClone(
        rawBefore.works.find(
          (w: Any) => w.RawData.value.id === CHEST_REPAIR_WORK_ID,
        ),
      );
      const originalContainerSnapshot = structuredClone(
        rawBefore.item_containers.find(
          (c: Any) => c.key.ID.value === CHEST_CONTAINER_ID,
        ),
      );

      const newId = mintGuid();
      const duplicate: PlacedObject = {
        ...(chest as PlacedObject),
        id: newId,
        origin: "duplicate",
        sourceId: CHEST_ID,
        position: {
          ...(chest as PlacedObject).position,
          x: (chest as PlacedObject).position.x + 400,
        },
      };

      const { raw: exportedRaw } = reconcileExport(loaded.raw, [
        ...objects,
        duplicate,
      ]);
      const out = exportedRaw as Any;

      // map_objects grew by exactly one.
      expect(out.map_objects.length).toBe(beforeMoCount + 1);

      const cloneMo = out.map_objects.find(
        (mo: Any) => mo.Model.value.RawData.value.instance_id === newId,
      );
      expect(cloneMo).toBeDefined();
      const cloneModelRd = cloneMo.Model.value.RawData.value;
      const cloneConcreteRd = cloneMo.ConcreteModel.value.RawData.value;

      // Model / ConcreteModel id triangle is self-consistent.
      expect(cloneModelRd.instance_id).toBe(newId);
      expect(cloneConcreteRd.instance_id).toBe(
        cloneModelRd.concrete_model_instance_id,
      );
      expect(cloneConcreteRd.model_instance_id).toBe(newId);

      // Fresh repair work, owned by the new model id.
      expect(cloneModelRd.repair_work_id).not.toBe(CHEST_REPAIR_WORK_ID);
      const cloneWork = out.works.find(
        (w: Any) => w.RawData.value.id === cloneModelRd.repair_work_id,
      );
      expect(cloneWork).toBeDefined();
      expect(cloneWork.RawData.value.owner_map_object_model_id).toBe(newId);

      // Fresh ItemContainer module + matching item_containers entry.
      const itemContainerModule = cloneMo.ConcreteModel.value.ModuleMap.value.find(
        (m: Any) => m.key === "EPalMapObjectConcreteModelModuleType::ItemContainer",
      );
      expect(itemContainerModule).toBeDefined();
      const newContainerId =
        itemContainerModule.value.RawData.value.target_container_id;
      expect(newContainerId).not.toBe(CHEST_CONTAINER_ID);
      const cloneContainer = out.item_containers.find(
        (c: Any) => c.key.ID.value === newContainerId,
      );
      expect(cloneContainer).toBeDefined();

      // The clone is free-standing: no inherited connector links.
      const cloneConnect =
        cloneMo.Model.value.Connector.value.RawData.value.connect;
      expect(cloneConnect.any_place).toEqual([]);

      // The ORIGINAL chest entry, its work, and its container are untouched.
      const originalMoAfter = out.map_objects.find(
        (mo: Any) => mo.Model.value.RawData.value.instance_id === CHEST_ID,
      );
      expect(originalMoAfter).toEqual(originalMoSnapshot);
      const originalWorkAfter = out.works.find(
        (w: Any) => w.RawData.value.id === CHEST_REPAIR_WORK_ID,
      );
      expect(originalWorkAfter).toEqual(originalWorkSnapshot);
      const originalContainerAfter = out.item_containers.find(
        (c: Any) => c.key.ID.value === CHEST_CONTAINER_ID,
      );
      expect(originalContainerAfter).toEqual(originalContainerSnapshot);
    });
  },
);

if (!fixtureExists) {
  test.skip(
    "fixture missing — writeback tests require fixtures/calibration_01.json",
    () => {},
  );
}
