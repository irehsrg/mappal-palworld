// Full-window drag-and-drop target for a PST blueprint export, plus a plain
// <input type="file"> fallback. Wired to useEditorStore.loadFile, which
// parses + validates + populates the editor's object list in one call.
import { useCallback, useRef, useState } from "react";
import { useEditorStore } from "../model/store";

export function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFile = useEditorStore((s) => s.loadFile);
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

  const loadFixture = useCallback(async () => {
    // Dev convenience only: Vite's dev server serves the whole project root,
    // so fixtures/calibration_01.json is reachable without moving/copying
    // it. Not available in the production build (import.meta.env.DEV gate
    // below) — there is no dev server there to serve it from.
    const res = await fetch("/fixtures/calibration_01.json");
    if (!res.ok) return;
    const text = await res.text();
    loadFile("calibration_01.json", text);
  }, [loadFile]);

  return (
    <div
      className={`drop-zone${isDragOver ? " drop-zone--active" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <p>Drag a PST base export (.json) here</p>
      <p className="drop-zone__or">— or —</p>
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        Choose file
      </button>
      <p className="drop-zone__hint">
        Don't have one? Export a base with{" "}
        <a
          href="https://github.com/deafdudecomputers/PalworldSaveTools"
          target="_blank"
          rel="noopener noreferrer"
        >
          PalworldSaveTools
        </a>{" "}
        first — Map Viewer → right-click your base → Export Base.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={onFileInputChange}
        style={{ display: "none" }}
      />
      {import.meta.env.DEV && (
        <>
          <p className="drop-zone__or">— or —</p>
          <button type="button" onClick={() => void loadFixture()}>
            Load calibration fixture (dev)
          </button>
        </>
      )}
      {loadError && <p className="drop-zone__error">{loadError}</p>}
    </div>
  );
}
