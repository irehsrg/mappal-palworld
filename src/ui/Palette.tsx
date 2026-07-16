// Phase 2 placement palette (CLAUDE.md §6): one button per PLACEABLE_TYPES
// entry (donor library types minus the palbox itself — see store.ts). Clicking
// arms place mode; the actual 3D ghost/click-to-place logic lives in
// src/scene/PlaceMode.tsx, src/scene/Scene.tsx and src/scene/ObjectBox.tsx —
// this component only owns arming state (via placeMode.ts) and the button UI.
//
// Category "world" types (CommonDropItem3D, DamagableRock0012 — not real
// buildables, see src/data/objects.json) are tucked behind a collapsed
// "Other" group per the task brief, rather than mixed in with structure/
// production/storage/decor pieces a player would actually want to place.
import { useState } from "react";
import { PLACEABLE_TYPES } from "../model/store";
import { getTypeEntry, resolveType } from "../scene/objectTypes";
import { usePlaceModeStore } from "../scene/placeModeStore";

function PaletteButton({ typeId }: { typeId: string }) {
  const armedType = usePlaceModeStore((s) => s.armedType);
  const toggle = usePlaceModeStore((s) => s.toggle);
  const armed = armedType === typeId;
  const resolved = resolveType(typeId);
  const name = getTypeEntry(typeId)?.name ?? typeId;

  return (
    <button
      type="button"
      className={`palette__button${armed ? " palette__button--armed" : ""}`}
      onClick={() => toggle(typeId)}
      title={armed ? "Click to stop placing (or press Escape)" : `Place ${name}`}
      aria-pressed={armed}
    >
      <span className="swatch" style={{ background: resolved.color }} />
      <span className="palette__button-label">{name}</span>
    </button>
  );
}

export function Palette() {
  const [otherOpen, setOtherOpen] = useState(false);
  const armedType = usePlaceModeStore((s) => s.armedType);

  const mainTypes = PLACEABLE_TYPES.filter((t) => resolveType(t).category !== "world");
  const otherTypes = PLACEABLE_TYPES.filter((t) => resolveType(t).category === "world");

  if (PLACEABLE_TYPES.length === 0) return null;

  return (
    <section className="sidebar__section">
      <h3>Place new object</h3>
      <p className="sidebar__hint">
        Click to place, Escape to stop. New pieces are unverified in-game until imported once.
      </p>
      <div className="palette">
        {mainTypes.map((typeId) => (
          <PaletteButton key={typeId} typeId={typeId} />
        ))}
      </div>

      {otherTypes.length > 0 && (
        <div className="palette__other">
          <button
            type="button"
            className="palette__other-toggle"
            onClick={() => setOtherOpen((v) => !v)}
            aria-expanded={otherOpen}
          >
            {otherOpen ? "▾" : "▸"} Other ({otherTypes.length})
          </button>
          {otherOpen && (
            <div className="palette">
              {otherTypes.map((typeId) => (
                <PaletteButton key={typeId} typeId={typeId} />
              ))}
            </div>
          )}
        </div>
      )}

      {armedType && (
        <p className="palette__armed-hint">
          Placing {getTypeEntry(armedType)?.name ?? armedType} — click in the viewport to stamp, hold Alt to
          disable grid snap, Escape to stop.
        </p>
      )}
    </section>
  );
}
