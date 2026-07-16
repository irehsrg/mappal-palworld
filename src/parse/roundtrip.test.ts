// Round-trip fidelity is CLAUDE.md's top priority (C5): load -> export with
// zero edits must produce a semantically identical file.
//
// This test can only run against a REAL PST export. We don't have one yet
// (fixtures/calibration_01.json is created during Phase 0 calibration, see
// docs/CALIBRATION.md and CLAUDE.md §3). Until that fixture exists, the test
// SKIPS with a clear message rather than failing — a missing fixture is not
// a code defect.
import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadBlueprint, serializeBlueprint } from "./blueprint";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/calibration_01.json");
const fixtureExists = existsSync(fixturePath);

describe.skipIf(!fixtureExists)(
  "blueprint round-trip (fixtures/calibration_01.json)",
  () => {
    test("load -> serialize -> reparse deep-equals the original parse", () => {
      const originalText = readFileSync(fixturePath, "utf-8");
      const originalParsed: unknown = JSON.parse(originalText);

      const loaded = loadBlueprint(originalText);
      const reserializedText = serializeBlueprint(loaded);
      const reparsed: unknown = JSON.parse(reserializedText);

      // toEqual is a deep structural comparison and ignores key order, which
      // is exactly what CLAUDE.md §0.3 asks for: "key ordering and float
      // formatting may differ; nothing else may." (Float formatting is not
      // exercised here since JSON.stringify(JSON.parse(x)) round-trips JS
      // numbers exactly; if PST-specific float formatting quirks turn up
      // during calibration, extend this test then.)
      expect(reparsed).toEqual(originalParsed);
    });
  },
);

if (!fixtureExists) {
  // Vitest's skipIf still needs at least one test node to report; this
  // separate top-level test makes the "why" visible in test output even for
  // reporters that collapse skipped describe blocks.
  test.skip(
    "fixture missing — blocked on Phase 0 calibration export (fixtures/calibration_01.json)",
    () => {},
  );
}
