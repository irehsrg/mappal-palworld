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
//   raycast + grid snap), renders the ghost box from it.
// - src/scene/Scene.tsx / ObjectBox.tsx: read armedType/hover via getState()
//   at click time to place instead of select/clear (see those files).
// - src/scene/MarqueeSelect.tsx: bails out of shift+drag while armed.
// - src/scene/useKeyboardControls.ts: Escape disarms (checked before the
//   normal clear-selection Escape handling).
import { create } from "zustand";
import type { Quat, Vec3 } from "../model/types";

/** Where the next click would place an object, already grid-snapped (see PlaceMode.tsx). Null when the pointer isn't over a valid ground hit (e.g. camera looking at the sky) or nothing is armed. */
export interface PlaceHover {
  position: Vec3;
  rotation: Quat;
}

interface PlaceModeState {
  /** typeId currently armed from the palette, or null if place mode is off. */
  armedType: string | null;
  hover: PlaceHover | null;
  arm(typeId: string): void;
  disarm(): void;
  /** Palette button behaviour: click arms; clicking the already-armed button again disarms. */
  toggle(typeId: string): void;
  setHover(hover: PlaceHover | null): void;
}

export const usePlaceModeStore = create<PlaceModeState>((set, get) => ({
  armedType: null,
  hover: null,
  arm: (typeId) => set({ armedType: typeId, hover: null }),
  disarm: () => set({ armedType: null, hover: null }),
  toggle: (typeId) => {
    const { armedType } = get();
    set(armedType === typeId ? { armedType: null, hover: null } : { armedType: typeId, hover: null });
  },
  setHover: (hover) => set({ hover }),
}));
