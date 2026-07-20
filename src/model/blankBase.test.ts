// "Start a blank base" strips a donor blueprint down to just the palbox, giving
// a free-build canvas. It goes through deleteSelection, so the guarantees there
// (palbox survives, export stays consistent) have to hold at full sweep size.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = readFileSync("fixtures/calibration_01.json", "utf8");

describe("blank base", () => {
  beforeEach(() => {
    useEditorStore.getState().loadFile("reset.json", FIXTURE);
  });

  it("leaves exactly the palbox", () => {
    useEditorStore.getState().loadBlankFrom("blank-base.json", FIXTURE);
    const { objects } = useEditorStore.getState();
    expect(objects).toHaveLength(1);
    expect(objects[0].typeId).toBe("PalBoxV2");
  });

  it("keeps the camp so radius guardrails still work on an empty canvas", () => {
    useEditorStore.getState().loadBlankFrom("blank-base.json", FIXTURE);
    expect(useEditorStore.getState().camp).not.toBeNull();
    expect(useEditorStore.getState().camp?.areaRange).toBeGreaterThan(0);
  });

  it("cannot be undone back into the donor base", () => {
    useEditorStore.getState().loadBlankFrom("blank-base.json", FIXTURE);
    // Undo history is the user's own work only. Ctrl+Z on a fresh blank base
    // must not repopulate it with the sample's foundations and chests.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().objects).toHaveLength(1);
  });

  it("exports a valid single-palbox blueprint", () => {
    useEditorStore.getState().loadBlankFrom("blank-base.json", FIXTURE);
    const out = useEditorStore.getState().exportBlueprint();
    expect(out).not.toBeNull();
    const after = JSON.parse(out!.text);
    expect(after.map_objects).toHaveLength(1);
    expect(after.map_objects[0].MapObjectId.value).toBe("PalBoxV2");
    // The camp entry has to survive: it is the base's identity on import.
    expect(after.base_camp.key).toBe(JSON.parse(FIXTURE).base_camp.key);
  });

  it("supports building on top of the blank canvas", () => {
    useEditorStore.getState().loadBlankFrom("blank-base.json", FIXTURE);
    const camp = useEditorStore.getState().camp!;
    useEditorStore
      .getState()
      .placeObject(
        "Wooden_foundation",
        { x: camp.position.x, y: camp.position.y, z: camp.position.z },
        { x: 0, y: 0, z: 0, w: 1 }
      );
    expect(useEditorStore.getState().objects).toHaveLength(2);
    const out = useEditorStore.getState().exportBlueprint();
    const after = JSON.parse(out!.text);
    expect(after.map_objects).toHaveLength(2);
  });
});
