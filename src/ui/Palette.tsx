// Phase 2 placement palette (CLAUDE.md §6): one button per PLACEABLE_TYPES
// entry (donor library types minus the palbox itself — see store.ts). Clicking
// arms place mode; the actual 3D ghost/click-to-place logic lives in
// src/scene/PlaceMode.tsx, src/scene/Scene.tsx and src/scene/ObjectBox.tsx —
// this component only owns arming state (via placeModeStore.ts) and the
// button/search/section UI.
//
// UX task "A. Palette organization": at 242 types, one flat list is
// unusable, so entries are grouped into collapsible sections — first by
// structural-kit typeId prefix (Wood/Wooden, Stone, Metal/Iron, SF,
// JapaneseStyle, Ancient), then by category for whatever's left
// (Production, Storage, Beds & Decor). Category "world" types
// (CommonDropItem3D, DamagableRock0012 — not real buildables, see
// src/data/objects.json) and the leftover non-kit structure/defense pieces
// (the Glass_* kit isn't one of the six named sections above) land in
// "Other" — this generalizes the old single "world types hidden behind
// Other" toggle into the same section system rather than a special case.
import { useEffect, useMemo, useState } from "react";
import { PLACEABLE_TYPES } from "../model/store";
import { getTypeEntry, resolveType } from "../scene/objectTypes";
import { usePlaceModeStore } from "../scene/placeModeStore";

type GroupKey =
  | "Wood"
  | "Stone"
  | "Metal"
  | "SF"
  | "JapaneseStyle"
  | "Ancient"
  | "Production"
  | "Storage"
  | "Decor"
  | "Other";

// Fixed display order per the task brief — kits first (in the order given),
// then the category fallbacks, "Other" always last (it's the dumping ground
// for world/unregistered/leftover-material pieces, least useful to browse).
const GROUP_ORDER: GroupKey[] = [
  "Wood",
  "Stone",
  "Metal",
  "SF",
  "JapaneseStyle",
  "Ancient",
  "Production",
  "Storage",
  "Decor",
  "Other",
];

const GROUP_LABEL: Record<GroupKey, string> = {
  Wood: "Wood",
  Stone: "Stone",
  Metal: "Metal",
  SF: "SF",
  JapaneseStyle: "Japanese Style",
  Ancient: "Ancient",
  Production: "Production",
  Storage: "Storage",
  Decor: "Beds & Decor",
  Other: "Other",
};

// Task brief: "structural kits collapsed except Wood, others collapsed" —
// Wood is the one section open by default, everything else starts closed
// (subject to whatever the user last left it at — see loadOpenState below).
const DEFAULT_OPEN: Record<GroupKey, boolean> = {
  Wood: true,
  Stone: false,
  Metal: false,
  SF: false,
  JapaneseStyle: false,
  Ancient: false,
  Production: false,
  Storage: false,
  Decor: false,
  Other: false,
};

const STORAGE_KEY = "mappal.palette.openSections";

function loadOpenState(): Record<GroupKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPEN, ...(JSON.parse(raw) as Partial<Record<GroupKey, boolean>>) };
  } catch {
    // localStorage unavailable (private browsing, etc.) or corrupt JSON —
    // fall back to defaults rather than throwing on every palette render.
  }
  return { ...DEFAULT_OPEN };
}

/**
 * Which section a typeId belongs in: world category first (keeps the old
 * "world types hidden behind Other" behavior, just folded into the general
 * section system), then structural-kit typeId prefix, then category. Any
 * structure/defense piece that doesn't match a named kit prefix — the
 * Glass_* line is the only one, see objectTypes.ts's MATERIAL_TINT, which
 * doesn't have its own section here — falls through to "Other" along with
 * anything unregistered.
 */
function groupForType(typeId: string): GroupKey {
  const category = resolveType(typeId).category;
  if (category === "world") return "Other";
  const k = typeId.toLowerCase();
  if (k.startsWith("wood")) return "Wood"; // covers both "Wood_" and "Wooden_"
  if (k.startsWith("stone")) return "Stone";
  if (k.startsWith("metal") || k.startsWith("iron")) return "Metal";
  if (k.startsWith("sf")) return "SF";
  if (k.startsWith("japanesestyle")) return "JapaneseStyle";
  if (k.startsWith("ancient")) return "Ancient";
  if (category === "production") return "Production";
  if (category === "storage") return "Storage";
  if (category === "decor") return "Decor";
  return "Other";
}

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

interface PaletteSectionProps {
  group: GroupKey;
  typeIds: string[];
  open: boolean;
  forcedOpen: boolean;
  onToggle: () => void;
}

function PaletteSection({ group, typeIds, open, forcedOpen, onToggle }: PaletteSectionProps) {
  if (typeIds.length === 0) return null;
  const isOpen = forcedOpen || open;
  return (
    <div className="palette__section">
      <button
        type="button"
        className="palette__section-toggle"
        onClick={onToggle}
        aria-expanded={isOpen}
        // Disabled while search forces every matching section open — toggling
        // would be a no-op visually (still forced open) and could leave the
        // persisted preference in a state the user didn't consciously pick.
        disabled={forcedOpen}
      >
        {isOpen ? "▾" : "▸"} {GROUP_LABEL[group]}
        <span className="palette__section-count">({typeIds.length})</span>
      </button>
      {isOpen && (
        <div className="palette">
          {typeIds.map((typeId) => (
            <PaletteButton key={typeId} typeId={typeId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Palette() {
  const armedType = usePlaceModeStore((s) => s.armedType);
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<GroupKey, boolean>>(loadOpenState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openSections));
    } catch {
      // Best-effort persistence only — a failed write shouldn't break the UI.
    }
  }, [openSections]);

  // PLACEABLE_TYPES is a static module-level array (built once from
  // donors.json at import time), so this grouping only needs to run once.
  const groups = useMemo(() => {
    const map = new Map<GroupKey, string[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const typeId of PLACEABLE_TYPES) map.get(groupForType(typeId))!.push(typeId);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = search.trim().toLowerCase();
  const matchesQuery = (typeId: string): boolean => {
    if (!query) return true;
    const name = (getTypeEntry(typeId)?.name ?? typeId).toLowerCase();
    return name.includes(query) || typeId.toLowerCase().includes(query);
  };

  if (PLACEABLE_TYPES.length === 0) return null;

  return (
    <section className="sidebar__section">
      <h3>Place new object</h3>
      <p className="sidebar__hint">
        Click to place, Escape to stop. New pieces are unverified in-game until imported once.
      </p>

      <input
        type="search"
        className="palette__search"
        placeholder={`Search ${PLACEABLE_TYPES.length} types…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // Local Escape handling only — stopPropagation so this never
          // reaches the window-level handler (useKeyboardControls.ts already
          // ignores keydowns targeting an <input> while it's focused, but
          // stopping here is the box's OWN Escape behavior, not a reliance
          // on that guard). Non-empty: clear the search. Empty: blur, so a
          // second Escape (now unfocused) hits the normal disarm/deselect
          // handling instead of doing nothing.
          e.stopPropagation();
          if (search) {
            e.preventDefault();
            setSearch("");
          } else {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />

      {GROUP_ORDER.map((group) => {
        const typeIds = (groups.get(group) ?? []).filter(matchesQuery);
        return (
          <PaletteSection
            key={group}
            group={group}
            typeIds={typeIds}
            open={openSections[group]}
            forcedOpen={query.length > 0}
            onToggle={() => setOpenSections((s) => ({ ...s, [group]: !s[group] }))}
          />
        );
      })}

      {armedType && (
        <p className="palette__armed-hint">
          Placing {getTypeEntry(armedType)?.name ?? armedType} — click in the viewport to stamp, PageUp/PageDown
          to raise/lower the ghost a level, hold Alt to disable grid snap, Shift+click to fill a line /
          Ctrl+Shift+click to fill a rectangle from the last stamp at the ghost's current level (each piece is
          its own undo step — Ctrl+Z spam works), Escape to stop.
        </p>
      )}
    </section>
  );
}
