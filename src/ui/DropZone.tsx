// Full-window drag-and-drop target for a PST blueprint export, plus a plain
// <input type="file"> fallback. Wired to useEditorStore.loadFile, which
// parses + validates + populates the editor's object list in one call.
import { useCallback, useRef, useState } from "react";
import { useEditorStore } from "../model/store";
import { galleryEnabled } from "../gallery/supabaseClient";
import { useGalleryStore } from "../gallery/galleryStore";

export function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFile = useEditorStore((s) => s.loadFile);
  const loadBlankFrom = useEditorStore((s) => s.loadBlankFrom);
  const loadError = useEditorStore((s) => s.loadError);

  const handleFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      loadFile(file.name, text);
    },
    [loadFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      // Reset so selecting the same file twice still fires onChange.
      e.target.value = "";
    },
    [handleFile],
  );

  const [sampleError, setSampleError] = useState<string | null>(null);

  // Sample base (public/sample-base.json — a copy of the calibration fixture:
  // palbox, a few foundations, walls, a chest and a workbench). Ships in the
  // production build deliberately:
  //   - Console players (Xbox/PS) can't reach their Level.sav at all, so PST
  //     can't export for them and they'd otherwise bounce off this screen.
  //     They can't import either, but they CAN use the editor as a planning
  //     canvas and rebuild the layout by hand in-game.
  //   - Everyone else gets to try the tool before installing PST.
  // Fetched on click, never at page load, so it costs nothing to visitors
  // who bring their own file.
  const loadSample = useCallback(async () => {
    setSampleError(null);
    try {
      const res = await fetch("/sample-base.json");
      if (!res.ok) throw new Error(`sample base unavailable (HTTP ${res.status})`);
      loadFile("sample-base.json", await res.text());
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    }
  }, [loadFile]);

  // Blank canvas: the same sample file stripped to its palbox. For designing a
  // build from nothing rather than editing an existing base — the free-craft
  // use case. Still a real exported blueprint underneath, so it imports.
  const loadBlank = useCallback(async () => {
    setSampleError(null);
    try {
      const res = await fetch("/sample-base.json");
      if (!res.ok) throw new Error(`sample base unavailable (HTTP ${res.status})`);
      loadBlankFrom("blank-base.json", await res.text());
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    }
  }, [loadBlankFrom]);

  return (
    <div
      className={`drop-zone${isDragOver ? " drop-zone--active" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <p>Drag a PST base export (.json) here</p>
      <p className="drop-zone__or">or</p>
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        Choose file
      </button>
      <p className="drop-zone__or">or</p>
      <div className="drop-zone__starters">
        <button type="button" onClick={() => void loadBlank()}>
          Start a blank base
        </button>
        <button type="button" onClick={() => void loadSample()}>
          Open a sample base
        </button>
      </div>
      <p className="drop-zone__starter-hint">
        Blank gives you an empty palbox to design into. Sample has a few
        foundations, walls and a chest to poke at.
      </p>
      {galleryEnabled && (
        <>
          <p className="drop-zone__or">or</p>
          <button type="button" onClick={() => useGalleryStore.getState().setGalleryOpen(true)}>
            Browse community bases
          </button>
        </>
      )}
      <p className="drop-zone__hint">
        Don't have a file? Export a base with{" "}
        <a
          href="https://github.com/deafdudecomputers/PalworldSaveTools"
          target="_blank"
          rel="noopener noreferrer"
        >
          PalworldSaveTools
        </a>{" "}
        — Map Viewer → right-click your base → Export Base. On console, save files aren't reachable, so importing isn't
        possible — but the sample base works as a planning canvas you can rebuild from in-game.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={onFileInputChange}
        style={{ display: "none" }}
      />
      {sampleError && <p className="drop-zone__error">{sampleError}</p>}
      {loadError && <p className="drop-zone__error">{loadError}</p>}
    </div>
  );
}
