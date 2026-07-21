// Publish flow (docs/GALLERY.md): title/description/visibility, the privacy
// disclosure, a thumbnail straight off the viewport canvas, then upload.
// The published text comes from the SAME exportBlueprint() as the Export
// button — published file ≡ exported file, no second serialization path to
// drift (CLAUDE.md C5).
import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../model/store";
import { useGalleryStore, sessionDisplayName } from "../gallery/galleryStore";
import { scanForPersonalData } from "../gallery/disclosure";
import { publishBase } from "../gallery/api";

/** JPEG snapshot of the R3F canvas. Needs preserveDrawingBuffer (Scene.tsx). */
async function captureThumbnail(): Promise<Blob | null> {
  const canvas = document.querySelector<HTMLCanvasElement>(".app__body canvas");
  if (!canvas) return null;
  // Downscale to card size — a full-res screenshot would blow the 512KB
  // bucket cap for nothing.
  const w = 480;
  const h = Math.round((canvas.height / canvas.width) * w);
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  off.getContext("2d")?.drawImage(canvas, 0, 0, w, h);
  return await new Promise((resolve) => off.toBlob(resolve, "image/jpeg", 0.85));
}

export function PublishDialog() {
  const setPublishOpen = useGalleryStore((s) => s.setPublishOpen);
  const session = useGalleryStore((s) => s.session);
  const signIn = useGalleryStore((s) => s.signIn);

  const fileName = useEditorStore((s) => s.fileName);
  const objects = useEditorStore((s) => s.objects);
  const blueprint = useEditorStore((s) => s.blueprint);
  const exportBlueprint = useEditorStore((s) => s.exportBlueprint);

  const [title, setTitle] = useState((fileName ?? "my base").replace(/\.json$/i, ""));
  const [description, setDescription] = useState("");
  // Default PRIVATE (Alex's call, 2026-07-21): first-time users poking at the
  // app shouldn't accidentally flow half-finished test bases into the public
  // gallery. Publishing publicly is a deliberate opt-in every time.
  const [isPublic, setIsPublic] = useState(false);
  const [state, setState] = useState<"idle" | "publishing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  // Privacy disclosure over the loaded raw blueprint — what this file
  // carries besides geometry. Computed once per open.
  const disclosure = useMemo(
    () => (blueprint ? scanForPersonalData(blueprint.raw) : null),
    [blueprint],
  );

  const typeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of objects) counts[o.typeId] = (counts[o.typeId] ?? 0) + 1;
    return counts;
  }, [objects]);

  // Escape closes — matches every other modal in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPublishOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPublishOpen]);

  const handlePublish = async () => {
    setError(null);
    setState("publishing");
    try {
      const result = exportBlueprint();
      if (!result) throw new Error("nothing to publish — no blueprint loaded");
      const thumbnail = await captureThumbnail();
      await publishBase({
        title: title.trim() || "untitled base",
        description: description.trim(),
        isPublic,
        ownerName: sessionDisplayName(session),
        blueprintText: result.text,
        pieceCount: objects.length,
        typeBreakdown,
        thumbnail,
      });
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  return (
    <div className="gallery-overlay" onClick={() => setPublishOpen(false)}>
      <div className="publish" onClick={(e) => e.stopPropagation()}>
        <h2>{isPublic ? "Publish to the community gallery" : "Save to your account"}</h2>

        {!session ? (
          <div className="publish__signin">
            <p>Sign in to publish or save bases. Publishing uploads this base; nothing is sent until you choose to.</p>
            <button type="button" onClick={() => void signIn("discord")}>
              Sign in with Discord
            </button>
            <button type="button" onClick={() => void signIn("github")}>
              Sign in with GitHub
            </button>
          </div>
        ) : state === "done" ? (
          <div className="publish__done">
            <p>
              {isPublic
                ? "Published. It's live in the community gallery."
                : "Saved to your account."}
            </p>
            <button type="button" onClick={() => setPublishOpen(false)}>
              Close
            </button>
          </div>
        ) : (
          <>
            <label className="publish__field">
              Title
              <input
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="publish__field">
              Description <span className="publish__hint">(optional — credits, build notes)</span>
              <textarea
                maxLength={2000}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="publish__toggle">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              Public — anyone can browse and open it. Unchecked = private save, only you see it.
            </label>

            {disclosure && (
              <div className="publish__disclosure">
                <strong>What this file contains besides the build:</strong>
                <ul>
                  <li>
                    {disclosure.characterCount === 0
                      ? "No pals/characters."
                      : `${disclosure.characterCount} pal/character entries — these can carry owner names and IDs from your world.`}
                  </li>
                  <li>
                    {disclosure.playerUids.length === 0
                      ? "No player IDs."
                      : `${disclosure.playerUids.length} distinct player ID${disclosure.playerUids.length === 1 ? "" : "s"} (piece builder/lock data). Single-player worlds typically show one placeholder ID.`}
                  </li>
                  {disclosure.campName && <li>Base camp name: "{disclosure.campName}"</li>}
                </ul>
                <span className="publish__hint">
                  MapPal never edits these fields — altering them could corrupt imports. Publish only
                  if you're comfortable sharing the file as-is.
                </span>
              </div>
            )}

            {error && <p className="gallery__error">{error}</p>}

            <div className="publish__actions">
              <button type="button" onClick={() => setPublishOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="publish__go"
                disabled={state === "publishing"}
                onClick={() => void handlePublish()}
              >
                {state === "publishing" ? "Uploading…" : isPublic ? "Publish" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
