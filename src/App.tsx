import { useEffect, useState } from "react";
import { Header } from "./ui/Header";
import { DropZone } from "./ui/DropZone";
import { AutosaveBanner } from "./ui/AutosaveBanner";
import { Sidebar } from "./ui/Sidebar";
import { LeftDock } from "./ui/LeftDock";
import { ExportNotesPanel } from "./ui/ExportNotesPanel";
import { FirstRunNotice } from "./ui/FirstRunNotice";
import { VisibilityBanner } from "./ui/VisibilityBanner";
import { Scene } from "./scene/Scene";
import { useKeyboardControls } from "./scene/useKeyboardControls";
import { useEditorStore } from "./model/store";
import { useVisibilityStore } from "./scene/visibilityStore";
import { startAutosave } from "./ui/autosave";
import { useGalleryStore } from "./gallery/galleryStore";
import { galleryEnabled } from "./gallery/supabaseClient";
import { fetchBaseRow, openBase } from "./gallery/api";
import { GalleryPanel } from "./ui/GalleryPanel";
import { PublishDialog } from "./ui/PublishDialog";

export function App() {
  const blueprint = useEditorStore((s) => s.blueprint);
  const [exportNotes, setExportNotes] = useState<string[] | null>(null);
  const galleryOpen = useGalleryStore((s) => s.galleryOpen);
  const publishOpen = useGalleryStore((s) => s.publishOpen);

  // Arrow-key nudge, Q/E rotate, delete, undo/redo, duplicate, escape — all
  // attached to `window` and self-disabling when nothing is loaded.
  useKeyboardControls();

  // Autosave loop: subscribes to the store, writes to IndexedDB every 20s
  // while dirty, flushes best-effort on tab close. See src/ui/autosave.ts.
  useEffect(() => startAutosave(), []);

  // Gallery deep links: /?base=<id> opens a shared base straight in the
  // editor — every gallery entry becomes a droppable-in-Discord URL. The
  // param is stripped after handling so refresh returns to a normal landing
  // (and a stale link never re-downloads over someone's session restore).
  useEffect(() => {
    if (!galleryEnabled) return;
    const params = new URLSearchParams(window.location.search);
    const baseId = params.get("base");
    if (!baseId) return;
    void (async () => {
      try {
        const row = await fetchBaseRow(baseId);
        if (!row) throw new Error("that base doesn't exist (or was deleted or made private)");
        const text = await openBase(row);
        useEditorStore.getState().loadFile(`${row.title}.json`, text);
      } catch (err) {
        // Surface on the drop-zone screen, same place file errors land.
        useEditorStore.setState({
          loadError: `shared base link failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("base");
        window.history.replaceState({}, "", url);
      }
    })();
  }, []);

  // Levels panel visibility lens (task brief §5: "Reset visibility
  // automatically on loadFile") — keyed on `blueprint`'s own identity, which
  // only changes on a fresh loadFile() call (same technique Scene.tsx's
  // centroid recentring uses), so a freshly loaded base never inherits the
  // previous file's hidden/soloed levels.
  const resetVisibility = useVisibilityStore((s) => s.reset);
  useEffect(() => {
    if (blueprint) resetVisibility();
  }, [blueprint, resetVisibility]);

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

        {blueprint && <VisibilityBanner />}

        {/* Left dock: the Levels hierarchy, full height (user feedback:
            "Levels should live on the LEFT edge") — collapsible to a thin
            strip, see LeftDock.tsx. */}
        {blueprint && <LeftDock />}

        {blueprint && (
          <div className="app__sidebar">
            <Sidebar />
          </div>
        )}
      </div>

      {exportNotes && <ExportNotesPanel notes={exportNotes} onDismiss={() => setExportNotes(null)} />}

      {/* Community gallery (docs/GALLERY.md) — modals over everything, only
          reachable when the Supabase env is configured. */}
      {galleryOpen && <GalleryPanel />}
      {publishOpen && blueprint && <PublishDialog />}
    </div>
  );
}
