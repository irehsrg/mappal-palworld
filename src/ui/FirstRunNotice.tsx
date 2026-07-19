// One-time banner for first-time visitors: the two rules that protect their
// save, before they've read any docs. Dismissal persists in localStorage.
import { useState } from "react";

const KEY = "mappal.firstRunNoticeDismissed";

export function FirstRunNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;

  return (
    <div className="first-run">
      <div className="first-run__body">
        <h3>Before you edit a real base</h3>
        <ol>
          <li>
            <strong>Back up your save folder first.</strong>{" "}
            <code>%LOCALAPPDATA%\Pal\Saved\SaveGames</code> — copy the whole
            world folder somewhere safe. Every time.
          </li>
          <li>
            <strong>Never import an edited file back into the world it was
            exported from</strong> — the game will silently delete the base.
            Export from one world, import into a different one.
          </li>
          <li>
            The game must be <strong>fully closed</strong> whenever
            PalworldSaveTools imports and saves.
          </li>
        </ol>
        <p className="first-run__fine">
          MapPal never touches .sav files — all save I/O happens in{" "}
          <a href="https://github.com/deafdudecomputers/PalworldSaveTools" target="_blank" rel="noreferrer">
            PalworldSaveTools
          </a>
          . Workflow details in the{" "}
          <a href="https://github.com/irehsrg/mappal-palworld#readme" target="_blank" rel="noreferrer">
            README
          </a>
          .
        </p>
      </div>
      <button
        type="button"
        className="first-run__dismiss"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* private browsing — banner just reappears next visit */
          }
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
