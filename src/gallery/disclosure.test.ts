// The publish privacy disclosure must report exactly what a real export
// carries — grounded against the calibration fixture (C4: real fields only).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanForPersonalData } from "./disclosure";

const FIXTURE = JSON.parse(readFileSync("fixtures/calibration_01.json", "utf8"));

describe("publish disclosure", () => {
  it("reports the calibration fixture accurately", () => {
    const d = scanForPersonalData(FIXTURE);
    expect(d.characterCount).toBe(0);
    // The fixture carries two non-zero player uids (host-placeholder
    // patterns): build_player_uid and pickupdable_player_uid values.
    expect(d.playerUids).toEqual([
      "00000000-0000-0000-0000-000000000001",
      "00000001-0000-0000-0000-000000000000",
    ]);
    // Default JP template name — present, and worth showing the user.
    expect(d.campName).toContain("テンプレート");
  });

  it("ignores all-zero sentinel uids", () => {
    const d = scanForPersonalData({
      map_objects: [
        { Model: { value: { RawData: { value: { build_player_uid: "00000000-0000-0000-0000-000000000000" } } } } },
      ],
    });
    expect(d.playerUids).toEqual([]);
  });

  it("counts characters and catches uid fields at any depth", () => {
    const d = scanForPersonalData({
      characters: [{}, {}, {}],
      deeply: { nested: { anything_player_uid: "12345678-aaaa-bbbb-cccc-000000000000" } },
    });
    expect(d.characterCount).toBe(3);
    expect(d.playerUids).toEqual(["12345678-aaaa-bbbb-cccc-000000000000"]);
  });

  it("never mutates the input (disclose, not transform)", () => {
    const input = JSON.parse(readFileSync("fixtures/calibration_01.json", "utf8"));
    const before = JSON.stringify(input);
    scanForPersonalData(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
