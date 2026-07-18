// Slim banner offering to restore a session found in IndexedDB, shown only
// while no file is loaded yet (App.tsx gates on `!blueprint`). Sits above
// DropZone — rendered after it in the tree so it paints on top.
import { useEffect, useState } from "react";
import { useEditorStore } from "../model/store";
import { formatRelativeTime, useAutosaveUi } from "./autosave";

export function AutosaveBanner() {
  const loadFile = useEditorStore((s) => s.loadFile);
  const record = useAutosaveUi((s) => s.restoreRecord);
  const dismissed = useAutosaveUi((s) => s.bannerDismissed);
  const dismissBanner = useAutosaveUi((s) => s.dismissBanner);
  const setRestoreRecord = useAutosaveUi((s) => s.setRestoreRecord);

  // "X ago" drifts as time passes — force a re-render every 30s so it
  // doesn't go stale while the banner sits there unattended.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!record || dismissed) return null;

  const handleRestore = () => {
    loadFile(record.fileName, record.text);
    // Loading a file hides the banner anyway (App.tsx gates on
    // `!blueprint`), but clear the record reference too so it can't
    // flash back if the load is ever retried.
    setRestoreRecord(null);
  };

  return (
    <div className="autosave-banner">
      <div className="autosave-banner__text">
        <span>
          Autosaved session from {formatRelativeTime(record.savedAt)} — {record.fileName},{" "}
          {record.editCount} edit{record.editCount === 1 ? "" : "s"}
        </span>
        <small>Restores the file, not the undo history.</small>
      </div>
      <div className="autosave-banner__actions">
        <button type="button" onClick={handleRestore}>
          Restore
        </button>
        <button type="button" onClick={dismissBanner}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
