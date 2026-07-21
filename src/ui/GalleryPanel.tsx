// Community gallery browser — full-screen modal over the app, opened from
// the header or the drop-zone. Two tabs: Community (public bases, newest
// first) and My bases (private saves + own published, sign-in required).
// Opening a base routes through the exact same loadFile() as drag-and-drop:
// the gallery is just another way files arrive (docs/GALLERY.md).
import { useCallback, useEffect, useState } from "react";
import { useEditorStore } from "../model/store";
import { useGalleryStore, sessionDisplayName } from "../gallery/galleryStore";
import {
  listPublicBases,
  listMyBases,
  openBase,
  deleteBase,
  reportBase,
  thumbUrl,
  type GalleryRow,
} from "../gallery/api";

type Tab = "community" | "mine";

function topTypes(breakdown: Record<string, number>, n = 3): string {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t, c]) => `${c}× ${t}`)
    .join(" · ");
}

export function GalleryPanel() {
  const setGalleryOpen = useGalleryStore((s) => s.setGalleryOpen);
  const session = useGalleryStore((s) => s.session);
  const signIn = useGalleryStore((s) => s.signIn);
  const signOut = useGalleryStore((s) => s.signOut);
  const loadFile = useEditorStore((s) => s.loadFile);

  const [tab, setTab] = useState<Tab>("community");
  const [rows, setRows] = useState<GalleryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async (which: Tab) => {
    setRows(null);
    setError(null);
    try {
      setRows(which === "community" ? await listPublicBases() : await listMyBases());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh(tab);
  }, [tab, refresh]);

  const handleOpen = async (row: GalleryRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      const text = await openBase(row);
      // loadFile validates with the full loader — a corrupt gallery blob
      // fails loudly on the drop-zone screen, it never half-loads.
      loadFile(`${row.title}.json`, text);
      setGalleryOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: GalleryRow) => {
    // Deleting someone's published base is irreversible; make them mean it.
    if (!window.confirm(`Delete "${row.title}" permanently? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteBase(row);
      await refresh(tab);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReport = async (row: GalleryRow) => {
    const reason = window.prompt(`Report "${row.title}" — what's wrong with it?`);
    if (!reason?.trim()) return;
    try {
      await reportBase(row.id, reason.trim());
      window.alert("Reported. Thanks — it will be reviewed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="gallery-overlay" onClick={() => setGalleryOpen(false)}>
      <div className="gallery" onClick={(e) => e.stopPropagation()}>
        <div className="gallery__header">
          <div className="gallery__tabs">
            <button
              type="button"
              className={tab === "community" ? "gallery__tab gallery__tab--active" : "gallery__tab"}
              onClick={() => setTab("community")}
            >
              Community
            </button>
            <button
              type="button"
              className={tab === "mine" ? "gallery__tab gallery__tab--active" : "gallery__tab"}
              onClick={() => setTab("mine")}
            >
              My bases
            </button>
          </div>
          <div className="gallery__auth">
            {session ? (
              <>
                <span className="gallery__user">{sessionDisplayName(session)}</span>
                <button type="button" onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => void signIn("discord")}>
                  Sign in with Discord
                </button>
                <button type="button" onClick={() => void signIn("github")}>
                  GitHub
                </button>
              </>
            )}
            <button type="button" className="gallery__close" onClick={() => setGalleryOpen(false)}>
              ✕
            </button>
          </div>
        </div>

        {error && <p className="gallery__error">{error}</p>}

        {tab === "mine" && !session ? (
          <p className="gallery__empty">Sign in to save bases to your account and see your published ones.</p>
        ) : rows === null ? (
          <p className="gallery__empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="gallery__empty">
            {tab === "community"
              ? "Nothing published yet — load a base and hit Publish to be the first."
              : "No saved bases yet. Load a base and use Publish → keep it private to save one here."}
          </p>
        ) : (
          <div className="gallery__grid">
            {rows.map((row) => {
              const thumb = thumbUrl(row);
              return (
                <div key={row.id} className="gallery-card">
                  {thumb ? (
                    <img className="gallery-card__thumb" src={thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="gallery-card__thumb gallery-card__thumb--empty">no preview</div>
                  )}
                  <div className="gallery-card__body">
                    <div className="gallery-card__title" title={row.title}>
                      {row.title}
                      {!row.is_public && <span className="gallery-card__private"> · private</span>}
                    </div>
                    <div className="gallery-card__meta">
                      {row.piece_count.toLocaleString()} pieces
                      {row.owner_name && <> · by {row.owner_name}</>}
                      {row.is_public && <> · {row.downloads} opens</>}
                    </div>
                    {row.description && <div className="gallery-card__desc">{row.description}</div>}
                    <div className="gallery-card__types">{topTypes(row.type_breakdown)}</div>
                    <div className="gallery-card__actions">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void handleOpen(row)}
                      >
                        {busyId === row.id ? "Opening…" : "Open in editor"}
                      </button>
                      {session?.user.id === row.owner ? (
                        <button
                          type="button"
                          className="gallery-card__danger"
                          disabled={busyId === row.id}
                          onClick={() => void handleDelete(row)}
                        >
                          Delete
                        </button>
                      ) : (
                        session && (
                          <button type="button" onClick={() => void handleReport(row)}>
                            Report
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
