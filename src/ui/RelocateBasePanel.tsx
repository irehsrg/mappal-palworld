// Sidebar panel: relocate the entire base by targeting a new position for
// the palbox. Computes delta = target - current palbox position and applies
// that same delta to every object's position in a single transformObjects()
// call — one undo step, rotations untouched (CLAUDE.md §11: bulk edits
// should be one undoable command, not N).
import { useEffect, useState } from "react";
import { useEditorStore } from "../model/store";
import { findPalbox } from "../scene/campGeometry";

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function RelocateBasePanel() {
  const objects = useEditorStore((s) => s.objects);
  const transformObjects = useEditorStore((s) => s.transformObjects);
  const { palbox, reason } = findPalbox(objects);

  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");

  // Re-seed the inputs from the palbox's current position when a new palbox
  // identity shows up (i.e. a new file loaded) — but leave an in-progress
  // edit alone otherwise, so typing isn't clobbered on unrelated re-renders.
  useEffect(() => {
    if (palbox) {
      setX(String(round(palbox.position.x)));
      setY(String(round(palbox.position.y)));
      setZ(String(round(palbox.position.z)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palbox?.id]);

  if (!palbox) {
    return (
      <section className="sidebar__section">
        <h3>Relocate base</h3>
        <p className="sidebar__empty">Relocation unavailable — {reason}.</p>
      </section>
    );
  }

  const target = { x: Number(x), y: Number(y), z: Number(z) };
  const valid = [target.x, target.y, target.z].every((n) => Number.isFinite(n));

  const handleMove = () => {
    if (!valid) return;
    const delta = {
      x: target.x - palbox.position.x,
      y: target.y - palbox.position.y,
      z: target.z - palbox.position.z,
    };
    const edits = objects.map((o) => ({
      id: o.id,
      position: {
        x: o.position.x + delta.x,
        y: o.position.y + delta.y,
        z: o.position.z + delta.z,
      },
      rotation: o.rotation,
    }));
    transformObjects(edits);
  };

  return (
    <section className="sidebar__section">
      <h3>Relocate base</h3>
      <p className="sidebar__hint">
        Sets where the base lands when imported (PST offsets ~80&nbsp;m to avoid collisions).
      </p>
      <p className="sidebar__hint sidebar__hint--muted">
        Current palbox position: ({round(palbox.position.x)}, {round(palbox.position.y)}, {round(palbox.position.z)})
      </p>
      <div className="relocate-form">
        <label>
          X
          <input type="number" step="any" value={x} onChange={(e) => setX(e.target.value)} />
        </label>
        <label>
          Y
          <input type="number" step="any" value={y} onChange={(e) => setY(e.target.value)} />
        </label>
        <label>
          Z
          <input type="number" step="any" value={z} onChange={(e) => setZ(e.target.value)} />
        </label>
      </div>
      {!valid && <p className="relocate-form__error">Enter finite X/Y/Z values.</p>}
      <button type="button" onClick={handleMove} disabled={!valid}>
        Move entire base here
      </button>
    </section>
  );
}
