// Sidebar panel: "Vertical stack" — bulk-stamps N copies of the armed type
// straight up (or down) from the last stamped piece, one VERTICAL_PITCH
// apart. Exists because arrayStamp.ts's Shift/Ctrl+Shift fills are
// deliberately horizontal-only (they fill at "the ghost's current level" —
// see PlaceMode.tsx/arrayStamp.ts): a tall shaft of wall pieces has no
// horizontal line/rect to fill, only a vertical run, so it needs its own
// tool rather than overloading the horizontal fill modifiers with a
// direction they weren't designed for.
//
// Same "loop placeObject(), one undo step per piece" mechanics/limitation as
// FillCirclePanel.tsx and arrayStamp.ts's line/rect fills (documented in
// Palette.tsx's armed-hint copy) — N pieces is N undo steps.
//
// See also useKeyboardControls.ts's Shift+PageUp/Shift+PageDown, which does
// the exact same single-copy-per-press operation as a keyboard "tap-tap-tap"
// alternative to this panel's button.
import { useState } from "react";
import { useEditorStore } from "../model/store";
import { VERTICAL_PITCH } from "../model/types";
import { usePlaceModeStore } from "../scene/placeModeStore";
import { getTypeEntry } from "../scene/objectTypes";

const DEFAULT_COUNT = 4;
const MIN_COUNT = 1;
const MAX_COUNT = 64;

export function VerticalStackPanel() {
  const placeObject = useEditorStore((s) => s.placeObject);
  const armedType = usePlaceModeStore((s) => s.armedType);
  const lastStampPos = usePlaceModeStore((s) => s.lastStampPos);
  const lastStampRotation = usePlaceModeStore((s) => s.lastStampRotation);

  const [countStr, setCountStr] = useState(String(DEFAULT_COUNT));
  const [lastResult, setLastResult] = useState<string | null>(null);

  const parsedCount = Number(countStr);
  const count = Number.isFinite(parsedCount)
    ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(parsedCount)))
    : DEFAULT_COUNT;

  const ready = !!armedType && !!lastStampPos && !!lastStampRotation;
  const armedName = armedType ? (getTypeEntry(armedType)?.name ?? armedType) : null;

  // Shared by both direction buttons: stamps `count` copies of the armed
  // type from lastStampPos, each VERTICAL_PITCH further in `dir` (+1 up, -1
  // down), same rotation as the last stamp throughout. Advances
  // lastStampPos/lastStampRotation to the LAST one placed (not the armed
  // type's original anchor) so pressing the same button again continues the
  // run in the same direction instead of restarting from the old anchor.
  const handleStack = (dir: 1 | -1) => {
    if (!armedType || !lastStampPos || !lastStampRotation) return;
    let pos = lastStampPos;
    for (let k = 1; k <= count; k++) {
      pos = { x: lastStampPos.x, y: lastStampPos.y, z: lastStampPos.z + dir * k * VERTICAL_PITCH };
      placeObject(armedType, pos, lastStampRotation);
    }
    usePlaceModeStore.getState().setLastStamp(pos, lastStampRotation);
    setLastResult(`stamped ${count} ${armedName ?? armedType} ${dir > 0 ? "upward" : "downward"}`);
  };

  return (
    <section className="sidebar__section">
      <h3>Vertical stack</h3>
      <p className="sidebar__hint">
        Stamps N copies of the armed type straight up (or down) from the last stamped piece, one floor apart — for
        shafts and towers that array-stamp's horizontal fill can't reach.
      </p>
      <div className="relocate-form">
        <label>
          Count (N)
          <input
            type="number"
            min={MIN_COUNT}
            max={MAX_COUNT}
            value={countStr}
            onChange={(e) => setCountStr(e.target.value)}
          />
        </label>
      </div>
      <div className="vertical-stack__buttons">
        <button type="button" onClick={() => handleStack(1)} disabled={!ready}>
          Stack {armedName ?? "armed type"} ×{count} upward
        </button>
        <button
          type="button"
          className="vertical-stack__down"
          onClick={() => handleStack(-1)}
          disabled={!ready}
          title={`Stack ${armedName ?? "armed type"} ×${count} downward`}
        >
          ▼
        </button>
      </div>
      {!ready && (
        <p className="sidebar__hint sidebar__hint--muted">
          {armedType ? "stamp one piece first" : "arm a type from the palette first"}
        </p>
      )}
      {lastResult && <p className="sidebar__hint sidebar__hint--muted">{lastResult}</p>}
    </section>
  );
}
