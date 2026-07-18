// Autosave + session restore. UI-owned: this module never touches
// src/model — it only calls useEditorStore's public API (loadFile,
// exportBlueprint, undoStack, blueprint) and persists a browser-local copy
// to IndexedDB so a crashed tab / closed browser doesn't lose edits.
//
// This is a convenience net, not a save path. PST is still the only way a
// blueprint reaches the game (CLAUDE.md C1/C3) — we're writing the same
// JSON exportBlueprint() would hand the user for a download, just to a
// local database instead of a file, so a reload can offer it back.
import { create } from "zustand";
import { useEditorStore } from "../model/store";

const DB_NAME = "mappal";
const STORE_NAME = "autosave";
const RECORD_KEY = "latest";
const SAVE_INTERVAL_MS = 20_000;

export interface AutosaveRecord {
  key: "latest";
  fileName: string;
  text: string;
  savedAt: number;
  editCount: number;
}

type AutosaveStatus = "idle" | "saved" | "unavailable";

interface AutosaveUiState {
  /** Header indicator state. "idle" = nothing saved yet this session. */
  status: AutosaveStatus;
  lastSavedAt: number | null;
  /** Autosaved record found at startup, offered by the restore banner. */
  restoreRecord: AutosaveRecord | null;
  bannerDismissed: boolean;
  markSaved(savedAt: number): void;
  markUnavailable(): void;
  setRestoreRecord(record: AutosaveRecord | null): void;
  dismissBanner(): void;
}

/** Small ui-local store (separate from useEditorStore) driving the header
 *  indicator and the restore banner. Not part of the editable model. */
export const useAutosaveUi = create<AutosaveUiState>((set) => ({
  status: "idle",
  lastSavedAt: null,
  restoreRecord: null,
  bannerDismissed: false,
  markSaved: (savedAt) => set({ status: "saved", lastSavedAt: savedAt }),
  markUnavailable: () => set({ status: "unavailable" }),
  setRestoreRecord: (record) => set({ restoreRecord: record }),
  dismissBanner: () => set({ bannerDismissed: true }),
}));

/** "12s ago" / "4m ago" / "3h ago" — coarse, header-indicator-friendly. */
export function formatRelativeTime(ms: number): string {
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** Throws on any IndexedDB failure — callers decide how to degrade. */
async function readAutosaveRecordUnsafe(): Promise<AutosaveRecord | null> {
  const db = await openDb();
  return new Promise<AutosaveRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as AutosaveRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
  });
}

/** Best-effort read for callers that just want "is there something to
 *  restore" without caring why a lookup failed. */
export async function readAutosaveRecord(): Promise<AutosaveRecord | null> {
  try {
    return await readAutosaveRecordUnsafe();
  } catch {
    return null;
  }
}

async function writeAutosaveRecord(record: AutosaveRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
  });
}

function stripEditedSuffix(filename: string): string {
  // exportBlueprint() names its download "<original>_edited.json"; the
  // autosave record should read back as the original file name.
  return filename.replace(/_edited(?=\.json$)/i, "");
}

// Module-level loop state. startAutosave() is idempotent — App mounts once
// in practice, but guard against StrictMode double-invoke / HMR anyway.
let started = false;
let dirty = false;
let disabled = false;

async function runAutosaveCycle(): Promise<void> {
  if (disabled || !dirty) return;
  const state = useEditorStore.getState();
  if (!state.blueprint) return;

  let result: ReturnType<typeof state.exportBlueprint>;
  try {
    result = state.exportBlueprint();
  } catch {
    // Pathological export state — skip this cycle silently, try again in
    // 20s. The user's in-editor work is unaffected either way.
    return;
  }
  if (!result) return;

  const record: AutosaveRecord = {
    key: "latest",
    fileName: stripEditedSuffix(result.filename),
    text: result.text,
    savedAt: Date.now(),
    editCount: state.undoStack.length,
  };

  try {
    await writeAutosaveRecord(record);
    dirty = false;
    useAutosaveUi.getState().markSaved(record.savedAt);
  } catch {
    disabled = true;
    useAutosaveUi.getState().markUnavailable();
  }
}

/** Wire up the autosave loop. Call once from App on mount; returns a
 *  teardown function. Safe to call in environments without IndexedDB
 *  (private browsing etc.) — degrades to "autosave unavailable". */
export function startAutosave(): () => void {
  if (started) return () => {};
  started = true;
  dirty = false;
  disabled = false;

  // Startup probe: is there a session to restore, and does IndexedDB even
  // work here? One read answers both.
  readAutosaveRecordUnsafe()
    .then((record) => useAutosaveUi.getState().setRestoreRecord(record))
    .catch(() => {
      disabled = true;
      useAutosaveUi.getState().markUnavailable();
    });

  let prevUndoLength = useEditorStore.getState().undoStack.length;
  const unsubscribe = useEditorStore.subscribe((state) => {
    if (state.undoStack.length !== prevUndoLength) {
      prevUndoLength = state.undoStack.length;
      dirty = true;
    }
  });

  const intervalId = setInterval(() => {
    void runAutosaveCycle();
  }, SAVE_INTERVAL_MS);

  const onBeforeUnload = () => {
    // Best-effort, non-blocking: fire-and-forget, don't await or delay
    // unload on it.
    void runAutosaveCycle();
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  return () => {
    started = false;
    unsubscribe();
    clearInterval(intervalId);
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
