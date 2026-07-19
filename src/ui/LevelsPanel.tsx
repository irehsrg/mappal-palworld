// Unity-Hierarchy-style Levels panel (task brief): one row per occupied
// build level (floor), letting an interior floor be selected and edited
// without every floor above it occluding it in the 3D view. Level numbering
// mirrors PlaceMode.tsx's own ghost-hint readout ("L4") — see
// src/scene/levels.ts — so a number seen here always matches the same floor
// while placing.
//
// This panel only ever touches two things: src/model/store.ts's selection
// (click a row/type to select, exactly like SelectionInfo's "All of type"
// button in Sidebar.tsx) and src/scene/visibilityStore.ts's hidden/solo
// state (a viewport-only lens — see that file's header). It never reads or
// writes anything else in the editor model.
import { useMemo, useState } from "react";
import { useEditorStore } from "../model/store";
import { findPalbox } from "../scene/campGeometry";
import { buildLevelIndex } from "../scene/levels";
import { getTypeEntry } from "../scene/objectTypes";
import { anyLevelsHidden, isLevelVisible, useVisibilityStore } from "../scene/visibilityStore";
import type { PlacedObject } from "../model/types";

/** Cap per-level type-breakdown rows before collapsing the rest (task brief §2), same pattern as Sidebar.tsx's MAX_TYPE_BREAKDOWN_ROWS. */
const MAX_TYPE_ROWS_PER_LEVEL = 8;

interface TypeCount {
  typeId: string;
  count: number;
  ids: string[];
}

function typeBreakdownFor(objects: PlacedObject[]): TypeCount[] {
  const byType = new Map<string, TypeCount>();
  for (const o of objects) {
    const entry = byType.get(o.typeId);
    if (entry) {
      entry.count++;
      entry.ids.push(o.id);
    } else {
      byType.set(o.typeId, { typeId: o.typeId, count: 1, ids: [o.id] });
    }
  }
  return [...byType.values()].sort((a, b) => b.count - a.count);
}

export function LevelsPanel() {
  const objects = useEditorStore((s) => s.objects);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);

  const hiddenLevels = useVisibilityStore((s) => s.hiddenLevels);
  const soloLevel = useVisibilityStore((s) => s.soloLevel);
  const toggleLevelHidden = useVisibilityStore((s) => s.toggleLevelHidden);
  const toggleSolo = useVisibilityStore((s) => s.toggleSolo);
  const showAll = useVisibilityStore((s) => s.showAll);

  // Panel-level collapse (task brief: "collapsible") and per-level expand
  // (task brief: "expand arrow reveals per-type children") are independent,
  // purely local UI state — neither affects the model or the visibility lens.
  const [collapsed, setCollapsed] = useState(false);
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set());

  // Same palbox lookup Sidebar.tsx's RadiusGuardrail and PlaceMode.tsx's
  // ghost-hint both already use — falls back to null (world Z=0 origin,
  // levels.ts's own fallback) when there's no single PalBoxV2, so the panel
  // still works on a file without one instead of going blank.
  const palboxZ = useMemo(() => findPalbox(objects).palbox?.position.z ?? null, [objects]);

  // Memoized level -> objects index (task brief §1), recomputed only when
  // the object list or the palbox's Z actually changes.
  const levelGroups = useMemo(() => buildLevelIndex(objects, palboxZ), [objects, palboxZ]);

  function toggleExpanded(level: number) {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  // Shared by the level-label button and each per-type child row: replace
  // the selection, or union into it when Shift is held — same "Shift adds"
  // convention as the 3D viewport's click-select and Sidebar.tsx's "All of
  // type" button.
  function selectIds(ids: string[], shiftKey: boolean) {
    setSelection(shiftKey ? [...new Set([...selection, ...ids])] : ids);
  }

  const hidden = anyLevelsHidden(hiddenLevels, soloLevel);

  return (
    <section className="sidebar__section">
      <div className="levels-panel__header">
        <button
          type="button"
          className="levels-panel__collapse-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <span className="levels-panel__caret">{collapsed ? "▸" : "▾"}</span>
          <h3>Levels</h3>
        </button>
        <button
          type="button"
          className="levels-panel__show-all"
          onClick={showAll}
          disabled={!hidden}
          title={hidden ? "Clear all hide/solo — show every level" : "Nothing hidden or soloed"}
        >
          show all
        </button>
      </div>

      {!collapsed && (
        <>
          {levelGroups.length === 0 && <p className="sidebar__empty">No objects loaded.</p>}
          <ul className="levels-panel__list">
            {levelGroups.map(({ level, objects: levelObjects }) => {
              const ids = levelObjects.map((o) => o.id);
              const expanded = expandedLevels.has(level);
              const visible = isLevelVisible(level, hiddenLevels, soloLevel);
              const soloed = soloLevel === level;
              const types = typeBreakdownFor(levelObjects);
              const shownTypes = types.slice(0, MAX_TYPE_ROWS_PER_LEVEL);
              const hiddenTypeCount = types.length - shownTypes.length;

              return (
                <li key={level} className="levels-panel__level">
                  <div className={`levels-panel__row${visible ? "" : " levels-panel__row--hidden"}`}>
                    <button
                      type="button"
                      className="levels-panel__expand"
                      onClick={() => toggleExpanded(level)}
                      title={expanded ? "Collapse" : `Expand — ${types.length} type${types.length === 1 ? "" : "s"}`}
                      aria-expanded={expanded}
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      className="levels-panel__label"
                      onClick={(e) => selectIds(ids, e.shiftKey)}
                      title={`Select all ${ids.length} object${ids.length === 1 ? "" : "s"} on L${level} (Shift adds)`}
                    >
                      L{level} · {ids.length}
                    </button>
                    <button
                      type="button"
                      className={`levels-panel__icon-btn${visible ? "" : " levels-panel__icon-btn--off"}`}
                      onClick={() => toggleLevelHidden(level)}
                      title={visible ? "Hide this level" : "Show this level"}
                    >
                      {visible ? "shown" : "hidden"}
                    </button>
                    <button
                      type="button"
                      className={`levels-panel__icon-btn${soloed ? " levels-panel__icon-btn--solo" : ""}`}
                      onClick={() => toggleSolo(level)}
                      title={soloed ? "Clear solo" : `Solo this level — show only L${level}±1`}
                    >
                      solo
                    </button>
                  </div>

                  {expanded && (
                    <ul className="levels-panel__types">
                      {shownTypes.map(({ typeId, count, ids: typeIds }) => (
                        <li key={typeId}>
                          <button
                            type="button"
                            className="levels-panel__type-row"
                            onClick={(e) => selectIds(typeIds, e.shiftKey)}
                            title={`Select these ${count} object${count === 1 ? "" : "s"} (Shift adds)`}
                          >
                            {getTypeEntry(typeId)?.name ?? typeId} ×{count}
                          </button>
                        </li>
                      ))}
                      {hiddenTypeCount > 0 && (
                        <li className="levels-panel__types-more">
                          …and {hiddenTypeCount} more type{hiddenTypeCount === 1 ? "" : "s"}
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
