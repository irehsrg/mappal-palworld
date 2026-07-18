// The palbox is the base's identity — mass delete/duplicate must never
// touch it (select-all sweeps are the normal editing gesture for clearing
// large areas, and they always include the palbox).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./store";

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");

describe("palbox protection", () => {
  beforeEach(() => {
    useEditorStore.getState().loadFile("calibration_01.json", FIXTURE);
  });

  it("select-all delete removes everything except the palbox", () => {
    const s = useEditorStore.getState();
    s.setSelection(s.objects.map((o) => o.id));
    useEditorStore.getState().deleteSelection();
    const remaining = useEditorStore.getState().objects;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].typeId).toBe("PalBoxV2");
  });

  it("select-all duplicate copies everything except the palbox", () => {
    const s = useEditorStore.getState();
    const before = s.objects.length;
    s.setSelection(s.objects.map((o) => o.id));
    useEditorStore.getState().duplicateSelection({ x: 400, y: 0, z: 0 });
    const after = useEditorStore.getState().objects;
    expect(after).toHaveLength(before * 2 - 1); // everything doubled but the palbox
    expect(after.filter((o) => o.typeId === "PalBoxV2")).toHaveLength(1);
  });

  it("deleting only the palbox is a no-op", () => {
    const s = useEditorStore.getState();
    const palbox = s.objects.find((o) => o.typeId === "PalBoxV2")!;
    s.setSelection([palbox.id]);
    useEditorStore.getState().deleteSelection();
    expect(useEditorStore.getState().objects.length).toBe(s.objects.length);
    expect(useEditorStore.getState().undoStack.length).toBe(0); // no empty command pushed
  });
});
