// Top bar: current file, live object count (+ the honest "build limit:
// unknown" guardrail note — CLAUDE.md §5, "the tool warns; the user
// decides", never invent a number we don't have), undo/redo, export.
import { useEffect, useState } from "react";
import { useEditorStore } from "../model/store";
import { formatRelativeTime, useAutosaveUi } from "./autosave";

export interface HeaderProps {
  onExported: (notes: string[]) => void;
}

/** Subtle "autosaved 12s ago" text, right of Export — proof-of-life for a
 *  loop the user otherwise never sees run. */
function AutosaveIndicator() {
  const status = useAutosaveUi((s) => s.status);
  const lastSavedAt = useAutosaveUi((s) => s.lastSavedAt);

  // Tick every second so the relative timestamp stays live without a save
  // actually having to happen.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (status === "unavailable") {
    return <span className="header__autosave header__autosave--warn">autosave unavailable</span>;
  }
  if (status === "idle" || lastSavedAt === null) return null;
  return <span className="header__autosave">autosaved {formatRelativeTime(lastSavedAt)}</span>;
}

export function Header({ onExported }: HeaderProps) {
  const fileName = useEditorStore((s) => s.fileName);
  const blueprint = useEditorStore((s) => s.blueprint);
  const objects = useEditorStore((s) => s.objects);
  const objectCount = objects.length;
  const undoCount = useEditorStore((s) => s.undoStack.length);
  const redoCount = useEditorStore((s) => s.redoStack.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setSelection = useEditorStore((s) => s.setSelection);
  const exportBlueprint = useEditorStore((s) => s.exportBlueprint);

  const handleSelectAll = () => setSelection(objects.map((o) => o.id));

  const handleExport = () => {
    // Never fail silently: an export error means the user's work looks
    // trapped. Surface the reason in the notes panel instead.
    let result: ReturnType<typeof exportBlueprint>;
    try {
      result = exportBlueprint();
    } catch (err) {
      onExported([
        "⚠ EXPORT FAILED — nothing was downloaded. Your edits are still in the editor.",
        err instanceof Error ? err.message : String(err),
        "Tip: Ctrl+Z past the last action often clears the state the export choked on. Then report this message.",
      ]);
      return;
    }
    if (!result) return;
    // Trigger a browser download of the exported text via a throwaway <a>.
    const blob = new Blob([result.text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onExported(result.notes);
  };

  return (
    <header className="header">
      <div className="header__title">
        <span className="header__name">{fileName ?? "MapPal — no file loaded"}</span>
        {blueprint && (
          <span
            className="header__count"
            title="Build limit: unknown — the game enforces one, we don't know it yet."
          >
            {objectCount} object{objectCount === 1 ? "" : "s"} · build limit: unknown
          </span>
        )}
      </div>

      {blueprint && (
        <div className="header__actions">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={objectCount === 0}
            title="Select all (Ctrl+A)"
          >
            Select all
          </button>
          <button type="button" onClick={undo} disabled={undoCount === 0} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={redoCount === 0} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" className="header__export" onClick={handleExport}>
            Export
          </button>
          <AutosaveIndicator />
        </div>
      )}
    </header>
  );
}
