// Spreadsheet-style range-select anchor (CLAUDE.md task brief §1 — shift-click
// = RANGE select, like a spreadsheet: click one corner, shift-click the
// opposite corner). A separate tiny zustand store, not React state local to
// Scene.tsx and not part of the model (src/model/ is off-limits for this
// feature — file ownership), because it must also be reset from
// useKeyboardControls.ts's Escape handler — a different hook entirely —
// whenever selection is cleared. Same "separate store because it's UI/
// interaction state, not editable-document state" rationale as
// placeModeStore.ts.
import { create } from "zustand";

interface SelectionAnchorState {
  /**
   * id of the most recently plain/ctrl/shift/alt-clicked object — the "far
   * corner" a subsequent shift-click ranges from. A shift-click's target
   * becomes the new anchor (chained shift-clicks extend, spreadsheet-style).
   * Null when nothing has been clicked yet, or after any "clear selection"
   * gesture (empty-space click, Escape).
   */
  anchorId: string | null;
  setAnchor(id: string | null): void;
}

export const useSelectionAnchorStore = create<SelectionAnchorState>((set) => ({
  anchorId: null,
  setAnchor: (id) => set({ anchorId: id }),
}));
