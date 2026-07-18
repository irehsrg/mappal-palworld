// Phase 2 "place new object" arming state (CLAUDE.md §6). Deliberately a
// separate zustand store from useEditorStore (src/model/store.ts) rather than
// living inside it: arming/hover are pure UI/scene interaction state, not
// part of the editable document, and src/model/ is off-limits for this
// feature (file ownership — see task brief). Named placeModeStore.ts (not
// placeMode.ts) to avoid colliding with PlaceMode.tsx on Windows' case-
// insensitive filesystem (TS treats the two names as the same file there).
// Consumed by:
// - src/ui/Palette.tsx: arm()/toggle() on click, reads armedType for
//   highlighting.
// - src/scene/PlaceMode.tsx: writes `hover` every pointer move (ground-plane
//   raycast + grid snap + array-stamp fill preview via arrayStamp.ts),
//   renders the ghost box(es) from it.
// - src/scene/Scene.tsx / ObjectBox.tsx: read armedType/hover/lastStampPos
//   via getState() at click time to place instead of select/clear, and to
//   compute Shift/Ctrl+Shift array fills (see arrayStamp.ts and those files).
// - src/scene/MarqueeSelect.tsx: bails out of shift+drag while armed.
// - src/scene/useKeyboardControls.ts: Escape disarms (checked before the
//   normal clear-selection Escape handling); "R" while armed cycles
//   ghostRotationSteps (see snapLattice.ts for how PlaceMode.tsx applies it);
//   PageUp/PageDown while armed adjust levelOffset instead of nudging a
//   selection (armed mode takes precedence over the unarmed PageUp/PageDown
//   selection-move behavior).
import { create } from "zustand";
import type { Quat, Vec3 } from "../model/types";

/** Where the next click would place an object, already grid-snapped (see PlaceMode.tsx). Null when the pointer isn't over a valid ground hit (e.g. camera looking at the sky) or nothing is armed. */
export interface PlaceHover {
  position: Vec3;
  rotation: Quat;
  /**
   * Which grid this hover snapped to, for the on-screen cursor hint (task
   * "1. Nearest-structure snapping"): "snap: <display name>" for a nearby
   * placed structure, "snap: palbox grid" / "snap: world grid" for the
   * fallback anchor, or "free" while Alt bypasses snapping. See
   * PlaceMode.tsx for how this is derived.
   */
  anchorLabel: string;
  /**
   * Array-stamp preview (task "B. Array stamping"): populated only while
   * Shift or Ctrl+Shift is held AND a lastStampPos anchor exists from
   * earlier in this armed session. The NEW cells a click would stamp right
   * now — the anchor cell itself is excluded (it's already a real placed
   * object), and the list is capped at arrayStamp.ts's MAX_STAMP_COUNT.
   * Undefined in plain single-stamp hover (no fill in progress).
   */
  fillPositions?: Vec3[];
  /** Uncapped new-cell count for the fill (may exceed fillPositions.length when capped) — drives the cursor count badge. */
  fillCountFull?: number;
}

interface PlaceModeState {
  /** typeId currently armed from the palette, or null if place mode is off. */
  armedType: string | null;
  hover: PlaceHover | null;
  /**
   * Grid position of the most recently stamped piece THIS armed session
   * (single, line, or rect — see arrayStamp.ts) — the anchor a Shift/
   * Ctrl+Shift click fills a line/rect from. Null before the first stamp,
   * and reset to null whenever the armed type changes or place mode is
   * disarmed (task brief: "changing armed type resets the last-stamp anchor").
   */
  lastStampPos: Vec3 | null;
  /**
   * Ghost rotation control ("R" key while armed — see useKeyboardControls.ts
   * and PlaceMode.tsx's snapLattice.ts usage). 0-3, each step = +90° about Z.
   * For CENTER/CORNER lattice pieces this rotates the placed rotation
   * directly; for EDGE pieces (walls) it only breaks a tie when the hover
   * point is ambiguous between two edges (near a corner) — the edge-implied
   * orientation wins otherwise. Reset to 0 on arm/type change, same as
   * lastStampPos (task brief: "reset on arm/type change").
   */
  ghostRotationSteps: number;
  /**
   * Vertical level control (PageUp/PageDown while armed — see
   * useKeyboardControls.ts and PlaceMode.tsx). Integer, positive = up,
   * negative = down, each unit = one VERTICAL_PITCH (325cm). Applied ON TOP
   * of PlaceMode.tsx's anchor-derived z (including the wall-cap default —
   * see snapLattice.ts-adjacent logic in PlaceMode.tsx). Reset to 0 on
   * arm/type change, same as ghostRotationSteps/lastStampPos.
   */
  levelOffset: number;
  arm(typeId: string): void;
  disarm(): void;
  /** Palette button behaviour: click arms; clicking the already-armed button again disarms. */
  toggle(typeId: string): void;
  setHover(hover: PlaceHover | null): void;
  setLastStampPos(pos: Vec3 | null): void;
  /** "R" while armed: cycles the ghost rotation 0deg -> 90deg -> 180deg -> 270deg -> 0deg. */
  rotateGhost(): void;
  /** PageUp/PageDown while armed: adjust the ghost's level offset by +-1 (see levelOffset doc above). */
  adjustLevelOffset(delta: number): void;
}

export const usePlaceModeStore = create<PlaceModeState>((set, get) => ({
  armedType: null,
  hover: null,
  lastStampPos: null,
  ghostRotationSteps: 0,
  levelOffset: 0,
  arm: (typeId) => set({ armedType: typeId, hover: null, lastStampPos: null, ghostRotationSteps: 0, levelOffset: 0 }),
  disarm: () => set({ armedType: null, hover: null, lastStampPos: null, ghostRotationSteps: 0, levelOffset: 0 }),
  toggle: (typeId) => {
    const { armedType } = get();
    set(
      armedType === typeId
        ? { armedType: null, hover: null, lastStampPos: null, ghostRotationSteps: 0, levelOffset: 0 }
        : { armedType: typeId, hover: null, lastStampPos: null, ghostRotationSteps: 0, levelOffset: 0 },
    );
  },
  setHover: (hover) => set({ hover }),
  setLastStampPos: (pos) => set({ lastStampPos: pos }),
  rotateGhost: () => set((s) => ({ ghostRotationSteps: (s.ghostRotationSteps + 1) % 4 })),
  adjustLevelOffset: (delta) => set((s) => ({ levelOffset: s.levelOffset + delta })),
}));
