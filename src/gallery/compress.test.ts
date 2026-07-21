// Gallery blobs are stored gzipped; a broken round-trip would corrupt every
// published base at once, so it gets the same treatment as parse round-trip.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gzipText, gunzipToText } from "./compress";

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");

describe("gallery compression", () => {
  it("round-trips a real blueprint byte-for-byte", async () => {
    const gz = await gzipText(FIXTURE);
    const back = await gunzipToText(gz);
    expect(back).toBe(FIXTURE);
  });

  it("actually compresses (the free-tier math depends on it)", async () => {
    const gz = await gzipText(FIXTURE);
    // Observed ~16×; assert a conservative 4× so the test doesn't flake on
    // compressor changes while still catching "accidentally stored raw".
    expect(gz.size).toBeLessThan(FIXTURE.length / 4);
  });

  it("round-trips non-ASCII content (JP base camp names)", async () => {
    const text = JSON.stringify({ name: "新規生成拠点テンプレート名0(仮)" });
    expect(await gunzipToText(await gzipText(text))).toBe(text);
  });
});
