// Editor state: a command stack over PlacedObject views (CLAUDE.md §8 —
// "Editor state is a command stack, not a soup of useState").
//
// The raw blob is never mutated while editing. Commands operate on the
// objects array only; reconcileExport() applies the net result onto a clone
// of raw at export time.

import { create } from "zustand";
import { loadBlueprint, serializeBlueprint, type LoadedBlueprint } from "../parse/blueprint";
import { extractCampInfo, extractObjects, type CampInfo } from "./blueprintView";
import { mintGuid, reconcileExport, type DonorLibrary } from "./writeback";
import { validateLinkage } from "./validate";
import type { PlacedObject, Quat, Vec3 } from "./types";
import donorsJson from "../data/donors.json";

/** Donor bundles harvested from real exports (tools/harvest-donors.ts). */
const DONORS = (donorsJson as { donors: DonorLibrary }).donors;
/** Types offerable in the palette: donors exist and placement is allowed. */
export const PLACEABLE_TYPES = Object.keys(DONORS).filter((t) => t !== "PalBoxV2");

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
  /** Camp anchor + build radius as loaded; null if the file's camp shape was unexpected. */
  camp: CampInfo | null;
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
  /** Place a new object from the donor library (Phase 2); selects it. */
  placeObject(typeId: string, position: Vec3, rotation: Quat): void;
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
    camp: null,
    selection: [],
    undoStack: [],
    redoStack: [],

    loadFile(name, text) {
      try {
        const bp = loadBlueprint(text);
        const objects = extractObjects(bp.raw);
        const camp = extractCampInfo(bp.raw);
        if (!camp) {
          bp.warnings.push(
            "base_camp transform/area_range not found where expected — radius guardrails disabled for this file"
          );
        }
        set({
          fileName: name,
          blueprint: bp,
          loadError: null,
          objects,
          camp,
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
          camp: null,
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
      // The palbox IS the base (camp anchor, map icon, import identity) — a
      // blueprint without one is broken. It survives any mass-delete sweep.
      const removed = objects
        .map((object, index) => ({ object, index }))
        .filter((r) => sel.has(r.object.id) && r.object.typeId !== "PalBoxV2");
      if (removed.length === 0) return;
      push({ kind: "delete", removed });
      set({ selection: [] });
    },

    duplicateSelection(offset) {
      const { objects, selection } = get();
      const sel = new Set(selection);
      const created = objects
        // A duplicated palbox would mean two camp anchors in one file —
        // the exact identity conflict that breaks imports. Skip it.
        .filter((o) => sel.has(o.id) && o.typeId !== "PalBoxV2")
        .map((o): PlacedObject => ({
          ...o,
          id: mintGuid(),
          // A copy of a palette-placed piece is just another placed piece
          // (donor-cloned at export). Only copies of file objects are
          // "duplicate" — chained duplicates keep cloning the real raw entry.
          origin: o.origin === "placed" ? "placed" : "duplicate",
          sourceId:
            o.origin === "original"
              ? o.id
              : o.origin === "duplicate"
                ? o.sourceId
                : undefined,
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

    placeObject(typeId, position, rotation) {
      if (!get().blueprint) return;
      if (!PLACEABLE_TYPES.includes(typeId)) return;
      const created: PlacedObject[] = [
        {
          id: mintGuid(),
          typeId,
          position,
          rotation,
          scale: { x: 1, y: 1, z: 1 },
          origin: "placed",
        },
      ];
      // Same command shape as duplicate: apply appends, revert removes.
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
      const { raw, notes } = reconcileExport(blueprint.raw, objects, DONORS);
      const lintWarnings = validateLinkage(raw);
      if (lintWarnings.length > 0) {
        notes.push(
          `⚠ export lint found ${lintWarnings.length} linkage issue(s):`,
          ...lintWarnings
        );
      } else {
        notes.push("export lint: linkage graph clean");
      }
      const text = serializeBlueprint({ raw, warnings: [] });
      const base = (fileName ?? "blueprint.json").replace(/\.json$/i, "");
      return { filename: `${base}_edited.json`, text, notes };
    },
  };
});
