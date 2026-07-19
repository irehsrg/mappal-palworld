import { useEffect, useState } from "react";
import { Header } from "./ui/Header";
import { DropZone } from "./ui/DropZone";
import { AutosaveBanner } from "./ui/AutosaveBanner";
import { Sidebar } from "./ui/Sidebar";
import { ExportNotesPanel } from "./ui/ExportNotesPanel";
import { FirstRunNotice } from "./ui/FirstRunNotice";
import { Scene } from "./scene/Scene";
import { useKeyboardControls } from "./scene/useKeyboardControls";
import { useEditorStore } from "./model/store";
import { startAutosave } from "./ui/autosave";

export function App() {
  const blueprint = useEditorStore((s) => s.blueprint);
  const [exportNotes, setExportNotes] = useState<string[] | null>(null);

  // Arrow-key nudge, Q/E rotate, delete, undo/redo, duplicate, escape — all
  // attached to `window` and self-disabling when nothing is loaded.
  useKeyboardControls();

  // Autosave loop: subscribes to the store, writes to IndexedDB every 20s
  // while dirty, flushes best-effort on tab close. See src/ui/autosave.ts.
  useEffect(() => startAutosave(), []);

  return (
    <div className="app">
      <Header onExported={setExportNotes} />

      <div className="app__body">
        {/* The 3D viewport always renders — proves the R3F/three stack works
            independent of whether a file is loaded. */}
        <Scene />

        {/* Until a blueprint is loaded, the drop zone covers the viewport.
            Once loaded, it steps aside for the sidebar. */}
        {!blueprint && <DropZone />}
        {!blueprint && <AutosaveBanner />}
        {!blueprint && <FirstRunNotice />}

        {blueprint && (
          <div className="app__sidebar">
            <Sidebar />
          </div>
        )}
      </div>

      {exportNotes && <ExportNotesPanel notes={exportNotes} onDismiss={() => setExportNotes(null)} />}
    </div>
  );
}
