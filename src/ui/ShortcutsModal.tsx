// Full keyboard shortcut reference, moved out of the sidebar (it used to be
// Sidebar.tsx's KeyboardCheatSheet section — user feedback: "massive box for
// controls" was crowding out the palette) and into an on-demand modal opened
// by the "?" button in Header.tsx. Same content, just relocated.
//
// Dismisses on Escape or an outside click, same convention as ToolPopover.tsx
// — Escape is handled in the capture phase with stopPropagation so it closes
// only this modal, not also whatever useKeyboardControls.ts's window-level
// Escape handler would otherwise do (disarm place mode / clear selection).
import { useEffect, useRef } from "react";

export interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS: [string, string][] = [
  ["Hold right-drag", "Fly (WASD move, Q/E down/up, Shift fast, scroll speed)"],
  ["Click", "Select (replaces selection; sets the range anchor)"],
  ["Shift-click", "Range-select: everything between the anchor and this object, added to selection (spreadsheet-style; chains)"],
  ["Ctrl-click", "Toggle this object in/out of the selection"],
  ["Alt-click", "Select all objects of this type (replaces selection)"],
  ["Alt+Shift-click", "Select all objects of this type, added to selection"],
  ["Click empty space", "Clear selection"],
  ["Arrow keys", "Nudge 1 grid unit (400cm) along selection's local axes"],
  ["PageUp / PageDown", "Move selection up/down 1 floor (325cm); while placing, adjusts the ghost's level instead"],
  ["Q / E", "Rotate ±90° about vertical axis (each object in place)"],
  ["Shift+Q / Shift+E", "Rotate the whole selection ±90° as a group, orbiting around the palbox (falls back to selection centroid if no single palbox)"],
  ["Delete / Backspace", "Delete selection"],
  ["Ctrl+D", "Duplicate selection"],
  ["Ctrl+A", "Select all"],
  ["Shift+drag empty space", "Box-select (adds to selection); disabled while placing"],
  ["Delete", "Delete selection — the palbox is always protected"],
  ["Ctrl+Z", "Undo"],
  ["Ctrl+Y / Ctrl+Shift+Z", "Redo"],
  ["Escape", "Stop placing, else clear selection"],
  ["Palette button", "Arm/disarm place mode for that object"],
  ["Click (while placing)", "Stamp a piece; stays armed for repeats"],
  ["R (while placing)", "Rotate ghost +90°; for walls, breaks a tie near a corner"],
  ["PageUp / PageDown (while placing)", "Raise/lower the ghost 1 level (325cm); hovering a roof/foundation near a wall defaults to capping it"],
  ["Tab (while placing)", "Lock/unlock the active anchor — freezes frame + level on a dense build; Tab again, Escape, or switching type unlocks"],
  ["Alt (while placing)", "Disable grid snap for that placement"],
  ["Shift+click (while placing)", "Fill a line from the last stamp to here, at the ghost's current level"],
  ["Ctrl+Shift+click (while placing)", "Fill a rectangle from the last stamp to here, at the ghost's current level"],
  ["Shift+PageUp / Shift+PageDown (while placing)", "Stamp one copy of the armed type a floor above/below the last stamp (325cm)"],
  ["Overlap check (while placing)", "A stamp landing on an existing same-type piece is skipped (\"already placed here\"); fills/stacks report placed/skipped counts"],
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div
      className="shortcuts-modal-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="shortcuts-modal" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-modal__header">
          <h2>Keyboard</h2>
          <button type="button" className="shortcuts-modal__close" onClick={onClose} title="Close (Escape)">
            ✕
          </button>
        </div>
        <dl className="cheat-sheet">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="cheat-sheet__row">
              <dt>{key}</dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
