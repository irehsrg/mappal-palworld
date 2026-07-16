// Tests for the zustand command-stack store (src/model/store.ts).
//
// CLAUDE.md §11 working agreement: "Every destructive path gets a test.
// Especially delete and duplicate." — exercised here at the store level
// (undo/redo semantics), complementing writeback.test.ts which exercises the
// pure export-time reconciliation.
//
// `useEditorStore` is a module-level singleton (zustand `create()` returns
// one store, not a fresh one per test). Every test below calls loadFile()
// first, which unconditionally resets objects/selection/undoStack/redoStack,
// so tests don't leak state into each other.

import { describe, test, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { useEditorStore } from "./store";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(here, "../../fixtures/calibration_01.json");
const fixtureExists = existsSync(fixturePath);
const fixtureText = fixtureExists ? readFileSync(fixturePath, "utf-8") : "";

const CHEST_ID = "c0faba7d-4197-ff54-3152-51b4a7a83d98";
const HOST_FOUNDATION_ID = "0dc348e9-4e5e-9dd5-8ee9-50bb3297c329";

describe.skipIf(!fixtureExists)("useEditorStore (fixtures/calibration_01.json)", () => {
  beforeEach(() => {
    useEditorStore.getState().loadFile("calibration_01.json", fixtureText);
  });

  test("loadFile parses all 22 objects with no load error", () => {
    const s = useEditorStore.getState();
    expect(s.loadError).toBeNull();
    expect(s.blueprint).not.toBeNull();
    expect(s.objects.length).toBe(22);
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });

  test("transformObjects: undo restores the previous position, redo re-applies it", () => {
    const before = useEditorStore
      .getState()
      .objects.find((o) => o.id === HOST_FOUNDATION_ID)!;
    expect(before).toBeDefined();
    const originalPosition = before.position;

    const newPosition = {
      x: originalPosition.x + 400,
      y: originalPosition.y,
      z: originalPosition.z,
    };
    useEditorStore.getState().transformObjects([
      { id: HOST_FOUNDATION_ID, position: newPosition, rotation: before.rotation },
    ]);

    let cur = useEditorStore
      .getState()
      .objects.find((o) => o.id === HOST_FOUNDATION_ID)!;
    expect(cur.position).toEqual(newPosition);
    expect(useEditorStore.getState().undoStack.length).toBe(1);
    expect(useEditorStore.getState().redoStack.length).toBe(0);

    useEditorStore.getState().undo();
    cur = useEditorStore.getState().objects.find((o) => o.id === HOST_FOUNDATION_ID)!;
    expect(cur.position).toEqual(originalPosition);
    expect(useEditorStore.getState().undoStack.length).toBe(0);
    expect(useEditorStore.getState().redoStack.length).toBe(1);

    useEditorStore.getState().redo();
    cur = useEditorStore.getState().objects.find((o) => o.id === HOST_FOUNDATION_ID)!;
    expect(cur.position).toEqual(newPosition);
    expect(useEditorStore.getState().undoStack.length).toBe(1);
    expect(useEditorStore.getState().redoStack.length).toBe(0);
  });

  test("deleteSelection: undo restores the object at its original array index", () => {
    const objectsBefore = useEditorStore.getState().objects;
    const index = objectsBefore.findIndex((o) => o.id === CHEST_ID);
    expect(index).toBeGreaterThanOrEqual(0);
    const originalCount = objectsBefore.length;

    useEditorStore.getState().setSelection([CHEST_ID]);
    useEditorStore.getState().deleteSelection();

    expect(useEditorStore.getState().objects.length).toBe(originalCount - 1);
    expect(
      useEditorStore.getState().objects.some((o) => o.id === CHEST_ID),
    ).toBe(false);
    // Selection is cleared as part of delete.
    expect(useEditorStore.getState().selection).toEqual([]);

    useEditorStore.getState().undo();

    const objectsAfterUndo = useEditorStore.getState().objects;
    expect(objectsAfterUndo.length).toBe(originalCount);
    expect(objectsAfterUndo[index]?.id).toBe(CHEST_ID);
    expect(objectsAfterUndo).toEqual(objectsBefore);
  });

  test("duplicateSelection: undo removes the copy and leaves the original in place", () => {
    const objectsBefore = useEditorStore.getState().objects;
    const originalCount = objectsBefore.length;

    useEditorStore.getState().setSelection([CHEST_ID]);
    useEditorStore.getState().duplicateSelection({ x: 400, y: 0, z: 0 });

    const afterDup = useEditorStore.getState();
    expect(afterDup.objects.length).toBe(originalCount + 1);
    const created = afterDup.objects.find((o) => o.origin === "duplicate");
    expect(created).toBeDefined();
    expect(created!.sourceId).toBe(CHEST_ID);
    // The new copy is selected.
    expect(afterDup.selection).toEqual([created!.id]);

    useEditorStore.getState().undo();

    const afterUndo = useEditorStore.getState();
    expect(afterUndo.objects.length).toBe(originalCount);
    expect(afterUndo.objects.some((o) => o.origin === "duplicate")).toBe(false);
    expect(afterUndo.objects).toEqual(objectsBefore);
  });

  test("a new command issued after undo clears the redo stack", () => {
    const before = useEditorStore
      .getState()
      .objects.find((o) => o.id === HOST_FOUNDATION_ID)!;

    useEditorStore.getState().transformObjects([
      {
        id: HOST_FOUNDATION_ID,
        position: { ...before.position, x: before.position.x + 400 },
        rotation: before.rotation,
      },
    ]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().redoStack.length).toBe(1);

    // A fresh command (delete) should wipe the redo stack, not just leave it
    // stale — otherwise a later redo() would resurrect an undone edit that
    // no longer applies to the current object set.
    useEditorStore.getState().setSelection([CHEST_ID]);
    useEditorStore.getState().deleteSelection();

    expect(useEditorStore.getState().redoStack).toEqual([]);
    expect(useEditorStore.getState().undoStack.length).toBe(1);
  });

  test("exportBlueprint filename is '<original>_edited.json'", () => {
    const result = useEditorStore.getState().exportBlueprint();
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("calibration_01_edited.json");
  });

  test("exportBlueprint returns null when nothing is loaded", () => {
    // loadFile with invalid text sets blueprint to null via the catch path.
    useEditorStore.getState().loadFile("bad.json", "not json");
    expect(useEditorStore.getState().blueprint).toBeNull();
    expect(useEditorStore.getState().loadError).not.toBeNull();
    expect(useEditorStore.getState().exportBlueprint()).toBeNull();
  });
});

if (!fixtureExists) {
  test.skip(
    "fixture missing — store tests require fixtures/calibration_01.json",
    () => {},
  );
}
