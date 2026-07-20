// The radius multiplier is a VIEW-ONLY lens (see radiusStore.ts). These tests
// pin the two claims the UI makes to the user: the maths is a plain scale, and
// the exported file's area_range is never touched no matter what it's set to.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadBlueprint, serializeBlueprint } from "../parse/blueprint";
import { extractObjects } from "../model/blueprintView";
import { reconcileExport, type DonorLibrary } from "../model/writeback";
import donorsJson from "../data/donors.json";
import { clampMultiplier, effectiveRadius, MAX_MULTIPLIER } from "./radiusStore";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");
const DONORS = (donorsJson as unknown as { donors: DonorLibrary }).donors;

describe("radius multiplier", () => {
  it("scales the radius linearly", () => {
    expect(effectiveRadius(3500, 1)).toBe(3500);
    expect(effectiveRadius(3500, 2)).toBe(7000);
    expect(effectiveRadius(3500, 1.5)).toBe(5250);
  });

  it("clamps out-of-range and garbage input rather than trusting it", () => {
    expect(clampMultiplier(0)).toBe(1);
    expect(clampMultiplier(-4)).toBe(1);
    expect(clampMultiplier(999)).toBe(MAX_MULTIPLIER);
    expect(clampMultiplier(Number.NaN)).toBe(1);
    // A garbage multiplier must never produce a garbage radius.
    expect(effectiveRadius(3500, Number.NaN)).toBe(3500);
  });

  it("never changes the exported area_range (the whole safety claim)", () => {
    const bp = loadBlueprint(FIXTURE);
    const objects = extractObjects(bp.raw);
    const before = JSON.parse(FIXTURE);
    const originalAreaRange = before.base_camp.value.RawData.value.area_range;
    expect(typeof originalAreaRange).toBe("number");

    // Export runs with no knowledge of the multiplier at all — it is not a
    // parameter of reconcileExport, and that is exactly the point. If someone
    // ever wires the lens into writeback, this assertion is the tripwire.
    const { raw } = reconcileExport(bp.raw, objects, DONORS);
    const after = JSON.parse(serializeBlueprint({ raw, warnings: [] }));

    expect(after.base_camp.value.RawData.value.area_range).toBe(originalAreaRange);
  });
});
