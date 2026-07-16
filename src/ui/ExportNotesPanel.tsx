// Dismissable panel shown after a successful export, listing the
// reconciliation notes returned by exportBlueprint() (e.g. "deleted 2
// object(s), 2 work entry(ies)...", "appended 1 duplicated object(s)").
export interface ExportNotesPanelProps {
  notes: string[];
  onDismiss: () => void;
}

export function ExportNotesPanel({ notes, onDismiss }: ExportNotesPanelProps) {
  return (
    <div className="export-notes">
      <div className="export-notes__header">
        <h3>Exported</h3>
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      {notes.length === 0 ? (
        <p>No changes to report — the file round-tripped as-is.</p>
      ) : (
        <ul>
          {notes.map((n, i) => (
            // Notes are free-text summary lines, not stable keys; index is fine for a short-lived, append-only list.
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
