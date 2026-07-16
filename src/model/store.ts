// Editor state: a command stack over PlacedObject views (CLAUDE.md §8 —
// "Editor state is a command stack, not a soup of useState").
//
// The raw blob is never mutated while editing. Commands operate on the
// objects array only; reconcileExport() applies the net result onto a clone
// of raw at export time.

import { create } from "zustand";
import { loadBlueprint, serializeBlueprint, type LoadedBlueprint } from "../parse/blueprint";
import { extractObjects } from "./blueprintView";
import { mintGuid, reconcileExport } from "./writeback";
import type { PlacedObject, Quat, Vec3 } from "./types";

interface TransformState {
  position: Vec3;
  rotation: Quat;
}
export interface TransformEdit {
  id: string;
  position: Vec3;
  rotation: Quat;
}

type Command =
  | { kind: "transform"; entries: { id: string; before: TransformState; after: TransformState }[] }
  | { kind: "delete"; removed: { object: PlacedObject; index: number }[] }
  | { kind: "duplicate"; created: PlacedObject[] };

function applyCommand(objects: PlacedObject[], cmd: Command): PlacedObject[] {
  switch (cmd.kind) {
    case "transform": {
      const byId = new Map(cmd.entries.map((e) => [e.id, e.after]));
      return objects.map((o) => {
        const t = byId.get(o.id);
        return t ? { ...o, position: t.position, rotation: t.rotation } : o;
      });
    }
    case "delete": {
      const ids = new Set(cmd.removed.map((r) => r.object.id));
      return objects.filter((o) => !ids.has(o.id));
    }
    case "duplicate":
      return [...objects, ...cmd.created];
  }
}

function revertCommand(objects: PlacedObject[], cmd: Command): PlacedObject[] {
  switch (cmd.kind) {
    case "transform": {
      const byId = new Map(cmd.entries.map((e) => [e.id, e.before]));
      return objects.map((o) => {
        const t = byId.get(o.id);
        return t ? { ...o, position: t.position, rotation: t.rotation } : o;
      });
    }
    case "delete": {
      // Reinsert at original indices (ascending) to keep ordering stable.
      const result = [...objects];
      for (const r of [...cmd.removed].sort((a, b) => a.index - b.index)) {
        result.splice(Math.min(r.index, result.length), 0, r.object);
      }
      return result;
    }
    case "duplicate": {
      const ids = new Set(cmd.created.map((o) => o.id));
      return objects.filter((o) => !ids.has(o.id));
    }
  }
}

export interface EditorState {
  fileName: string | null;
  blueprint: LoadedBlueprint | null;
  loadError: string | null;
  objects: PlacedObject[];
  /** Selected object ids. */
  selection: string[];
  undoStack: Command[];
  redoStack: Command[];

  loadFile(name: string, text: string): void;
  setSelection(ids: string[]): void;
  toggleSelect(id: string): void;
  clearSelection(): void;
  /** One undoable step covering all entries (e.g. nudging a multi-selection). */
  transformObjects(edits: TransformEdit[]): void;
  deleteSelection(): void;
  /** Duplicate current selection, offset in Unreal space; selects the copies. */
  duplicateSelection(offset: Vec3): void;
  undo(): void;
  redo(): void;
  /** null when nothing is loaded. */
  exportBlueprint(): { filename: string; text: string; notes: string[] } | null;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const push = (cmd: Command) =>
    set((s) => ({
      objects: applyCommand(s.objects, cmd),
      undoStack: [...s.undoStack, cmd],
      redoStack: [],
    }));

  return {
    fileName: null,
    blueprint: null,
    loadError: null,
    objects: [],
    selection: [],
    undoStack: [],
    redoStack: [],

    loadFile(name, text) {
      try {
        const bp = loadBlueprint(text);
        const objects = extractObjects(bp.raw);
        set({
          fileName: name,
          blueprint: bp,
          loadError: null,
          objects,
          selection: [],
          undoStack: [],
          redoStack: [],
        });
      } catch (err) {
        set({
          fileName: name,
          blueprint: null,
          loadError: err instanceof Error ? err.message : String(err),
          objects: [],
          selection: [],
          undoStack: [],
          redoStack: [],
        });
      }
    },

    setSelection: (ids) => set({ selection: ids }),
    toggleSelect: (id) =>
      set((s) => ({
        selection: s.selection.includes(id)
          ? s.selection.filter((x) => x !== id)
          : [...s.selection, id],
      })),
    clearSelection: () => set({ selection: [] }),

    transformObjects(edits) {
      if (edits.length === 0) return;
      const byId = new Map(get().objects.map((o) => [o.id, o]));
      const entries = edits.flatMap((e) => {
        const cur = byId.get(e.id);
        if (!cur) return [];
        return [
          {
            id: e.id,
            before: { position: cur.position, rotation: cur.rotation },
            after: { position: e.position, rotation: e.rotation },
          },
        ];
      });
      if (entries.length > 0) push({ kind: "transform", entries });
    },

    deleteSelection() {
      const { objects, selection } = get();
      const sel = new Set(selection);
      const removed = objects
        .map((object, index) => ({ object, index }))
        .filter((r) => sel.has(r.object.id));
      if (removed.length === 0) return;
      push({ kind: "delete", removed });
      set({ selection: [] });
    },

    duplicateSelection(offset) {
      const { objects, selection } = get();
      const sel = new Set(selection);
      const created = objects
        .filter((o) => sel.has(o.id))
        .map((o): PlacedObject => ({
          ...o,
          id: mintGuid(),
          origin: "duplicate",
          // Chained duplicates still clone from the real raw entry.
          sourceId: o.origin === "original" ? o.id : o.sourceId,
          position: {
            x: o.position.x + offset.x,
            y: o.position.y + offset.y,
            z: o.position.z + offset.z,
          },
        }));
      if (created.length === 0) return;
      push({ kind: "duplicate", created });
      set({ selection: created.map((o) => o.id) });
    },

    undo() {
      const { undoStack, objects } = get();
      const cmd = undoStack[undoStack.length - 1];
      if (!cmd) return;
      set((s) => ({
        objects: revertCommand(objects, cmd),
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, cmd],
      }));
    },

    redo() {
      const { redoStack, objects } = get();
      const cmd = redoStack[redoStack.length - 1];
      if (!cmd) return;
      set((s) => ({
        objects: applyCommand(objects, cmd),
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, cmd],
      }));
    },

    exportBlueprint() {
      const { blueprint, objects, fileName } = get();
      if (!blueprint) return null;
      const { raw, notes } = reconcileExport(blueprint.raw, objects);
      const text = serializeBlueprint({ raw, warnings: [] });
      const base = (fileName ?? "blueprint.json").replace(/\.json$/i, "");
      return { filename: `${base}_edited.json`, text, notes };
    },
  };
});
