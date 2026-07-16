// Top bar: current file, live object count (+ the honest "build limit:
// unknown" guardrail note — CLAUDE.md §5, "the tool warns; the user
// decides", never invent a number we don't have), undo/redo, export.
import { useEditorStore } from "../model/store";

export interface HeaderProps {
  onExported: (notes: string[]) => void;
}

export function Header({ onExported }: HeaderProps) {
  const fileName = useEditorStore((s) => s.fileName);
  const blueprint = useEditorStore((s) => s.blueprint);
  const objectCount = useEditorStore((s) => s.objects.length);
  const undoCount = useEditorStore((s) => s.undoStack.length);
  const redoCount = useEditorStore((s) => s.redoStack.length);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const exportBlueprint = useEditorStore((s) => s.exportBlueprint);

  const handleExport = () => {
    const result = exportBlueprint();
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
          <span className="header__count">
            {objectCount} object{objectCount === 1 ? "" : "s"} · build limit: unknown
          </span>
        )}
      </div>

      {blueprint && (
        <div className="header__actions">
          <button type="button" onClick={undo} disabled={undoCount === 0} title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={redoCount === 0} title="Redo (Ctrl+Y / Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" className="header__export" onClick={handleExport}>
            Export
          </button>
        </div>
      )}
    </header>
  );
}
