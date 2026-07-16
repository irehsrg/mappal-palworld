// Loader sanity-check tests for src/parse/blueprint.ts, distinct from
// roundtrip.test.ts's fidelity gate. CLAUDE.md §0.1.4 / §3: "The loader
// should sanity-check incoming files for the top-level shape derived here
// and fail loudly (not guess) if a future PST version emits something
// different." REQUIRED_KEYS / EXPECTED_KEYS below are taken verbatim from
// docs/SCHEMA.md's top-level shape and blueprint.ts's own comments (which
// cite PST's is_old_blueprint check).

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBlueprint } from "./blueprint";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/calibration_01.json");
const fixtureExists = existsSync(fixturePath);

describe("loadBlueprint sanity checks", () => {
  test("rejects invalid JSON with a message about JSON parsing", () => {
    expect(() => loadBlueprint("{not json")).toThrow(/not valid JSON/i);
  });

  test("rejects a JSON array (not an object) at the top level", () => {
    expect(() => loadBlueprint("[]")).toThrow(/not a JSON object/i);
  });

  test("rejects an object missing required top-level keys, naming them", () => {
    // '{"foo":1}' is valid JSON but has neither dynamic_items nor
    // base_camp_level — the two keys blueprint.ts's REQUIRED_KEYS says PST's
    // own is_old_blueprint check hard-requires.
    expect(() => loadBlueprint('{"foo":1}')).toThrow(/dynamic_items/);
    expect(() => loadBlueprint('{"foo":1}')).toThrow(/base_camp_level/);
  });

  describe.skipIf(!fixtureExists)("against the real fixture", () => {
    test("a copy of the fixture with an extra unknown top-level key loads with a warning naming it", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const parsed = JSON.parse(originalText) as Record<string, unknown>;

      // Add an unknown top-level key — simulates a future PST version
      // growing the schema. Required keys are all still present, so this
      // must load (not throw), just with a warning.
      const withExtraKey = { ...parsed, mystery_field: 123 };
      const text = JSON.stringify(withExtraKey);

      const { warnings } = loadBlueprint(text);
      expect(warnings.some((w) => w.includes("mystery_field"))).toBe(true);
    });

    test("the real fixture loads with zero warnings (it matches the calibrated schema exactly)", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const { warnings } = loadBlueprint(originalText);
      expect(warnings).toEqual([]);
    });
  });
});

if (!fixtureExists) {
  test.skip(
    "fixture missing — some loadBlueprint sanity checks require fixtures/calibration_01.json",
    () => {},
  );
}
