// Viewport-only visibility lens over build levels (Unity-Hierarchy-style
// Levels panel, src/ui/LevelsPanel.tsx). This is a scene-side store,
// deliberately separate from src/model/store.ts: hiding/soloing a level
// changes what's RENDERED and CLICKABLE in the 3D viewport, never the
// underlying objects array, guardrails, or export — a viewport filter must
// never leak into data (CLAUDE.md §5: "the tool warns; the user decides",
// C5: round-trip fidelity). See src/scene/levels.ts for the level-assignment
// math shared with the sidebar panel.
//
// hiddenLevels/soloLevel are consumed both by React components (ObjectBox.tsx
// subscribes normally, so a toggle re-renders exactly the affected boxes) and
// by native event handlers outside React's render cycle (MarqueeSelect.tsx's
// pointerup, PlaceMode.tsx's placed-mesh raycast list) via
// useVisibilityStore.getState() — same pattern usePlaceModeStore.getState()
// already uses elsewhere in this codebase for the same reason (native
// listeners need the LATEST state at event time, not a stale render-time
// closure).
import { create } from "zustand";

export interface VisibilityState {
  /** Levels explicitly hidden via the panel's per-level eye toggle. */
  hiddenLevels: Set<number>;
  /** Non-null while a level is soloed: only that level ±1 is visible (task brief §2/§3). */
  soloLevel: number | null;
  toggleLevelHidden(level: number): void;
  /** Clicking solo on the already-soloed level clears solo (task brief §2). */
  toggleSolo(level: number): void;
  /** Header row "show all" reset, and the viewport banner chip's click target (task brief §5). */
  showAll(): void;
  /** Called on loadFile (App.tsx) so a freshly loaded blueprint never inherits the previous file's hidden/soloed levels. */
  reset(): void;
}

export const useVisibilityStore = create<VisibilityState>((set, get) => ({
  hiddenLevels: new Set(),
  soloLevel: null,

  toggleLevelHidden(level) {
    // New Set instance (not a mutate-in-place) — Sets are compared by
    // reference everywhere this state is read (React's useSyncExternalStore
    // subscription in components, dependency arrays in scene effects), so an
    // in-place .add()/.delete() would silently fail to trigger either.
    const next = new Set(get().hiddenLevels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    set({ hiddenLevels: next });
  },

  toggleSolo(level) {
    set((s) => ({ soloLevel: s.soloLevel === level ? null : level }));
  },

  showAll() {
    set({ hiddenLevels: new Set(), soloLevel: null });
  },

  reset() {
    set({ hiddenLevels: new Set(), soloLevel: null });
  },
}));

/** Effective visibility rule (task brief §3): an active solo wins outright over the hidden-levels set. */
export function isLevelVisible(level: number, hiddenLevels: Set<number>, soloLevel: number | null): boolean {
  if (soloLevel !== null) return Math.abs(level - soloLevel) <= 1;
  return !hiddenLevels.has(level);
}

/** True whenever the viewport is showing less than everything — drives the persistent banner chip (task brief §5). */
export function anyLevelsHidden(hiddenLevels: Set<number>, soloLevel: number | null): boolean {
  return soloLevel !== null || hiddenLevels.size > 0;
}
