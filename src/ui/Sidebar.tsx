// Right-hand panel: decluttered per user feedback ("the right sidebar is
// overloaded") — the Levels hierarchy moved to LeftDock.tsx, the build tools
// (Circle/Stack/Relocate) moved into Header.tsx's toolbar popovers, and the
// keyboard cheat-sheet moved into Header.tsx's "?" modal (ShortcutsModal.tsx).
// What's left, in order: Palette (the primary tool — gets the space),
// category counts, selection info + per-type breakdown, guardrails
// (radius/height/duplicates), and warnings. Only shown once a blueprint is
// loaded (App.tsx).
import { useMemo } from "react";
import { useEditorStore } from "../model/store";
import { VERTICAL_PITCH } from "../model/types";
import { CATEGORY_COLOR, CATEGORY_LABEL, countByCategory, getTypeEntry, unknownDimensionTypes } from "../scene/objectTypes";
import { countOutsideRadius, findPalbox } from "../scene/campGeometry";
import { effectiveRadius, MAX_MULTIPLIER, MIN_MULTIPLIER, useRadiusStore } from "../scene/radiusStore";
import { findDuplicateClusters } from "../scene/overlapCheck";
import { Palette } from "./Palette";

function round(n: number): number {
  return Math.round(n);
}

function CategoryCounts() {
  const objects = useEditorStore((s) => s.objects);
  const counts = countByCategory(objects);

  return (
    <section className="sidebar__section">
      <h3>Objects by category</h3>
      <ul className="category-counts">
        {counts.map(({ category, count }) => (
          <li key={category}>
            <span
              className="swatch"
              style={{ background: category === "unknown" ? "#ff00ff" : CATEGORY_COLOR[category] }}
            />
            <span className="category-counts__label">{category === "unknown" ? "Unknown type" : CATEGORY_LABEL[category]}</span>
            <span className="category-counts__value">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Max per-type rows shown in the breakdown before collapsing the rest into "…and N more types" (task brief §2). */
const MAX_TYPE_BREAKDOWN_ROWS = 6;

function SelectionInfo() {
  const objects = useEditorStore((s) => s.objects);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const selected = objects.filter((o) => selection.includes(o.id));

  // Per-type breakdown of the current selection (task brief §2: "Glass Roof
  // ×140" rows with a "select all of this type" button each) — e.g. after a
  // range-select grabs a mixed patch of roof/wall/foundation, this shows
  // what actually got caught and lets you narrow to just one type.
  const typeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of selected) counts.set(o.typeId, (counts.get(o.typeId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([typeId, count]) => ({ typeId, count, name: getTypeEntry(typeId)?.name ?? typeId }))
      .sort((a, b) => b.count - a.count);
  }, [selected]);
  const shownTypes = typeBreakdown.slice(0, MAX_TYPE_BREAKDOWN_ROWS);
  const hiddenTypeCount = typeBreakdown.length - shownTypes.length;

  return (
    <section className="sidebar__section">
      <h3>Selection</h3>
      {selected.length === 0 && <p className="sidebar__empty">Nothing selected. Click a box in the scene.</p>}
      {selected.length > 0 && (
        <>
          <ul className="type-breakdown">
            {shownTypes.map(({ typeId, count, name }) => (
              <li key={typeId}>
                <span className="type-breakdown__label">
                  {name} ×{count}
                </span>
                <button
                  type="button"
                  className="type-breakdown__select-all"
                  title={`Select all ${count > 1 ? "" : "other "}${name} in this base`}
                  onClick={() => setSelection(objects.filter((o) => o.typeId === typeId).map((o) => o.id))}
                >
                  All of type
                </button>
              </li>
            ))}
            {hiddenTypeCount > 0 && (
              <li className="type-breakdown__more">…and {hiddenTypeCount} more type{hiddenTypeCount === 1 ? "" : "s"}</li>
            )}
          </ul>
          <ul className="selection-list">
            {selected.slice(0, 8).map((o) => (
              <li key={o.id}>
                <div className="selection-list__type">{o.typeId}</div>
                <div className="selection-list__meta">
                  pos ({round(o.position.x)}, {round(o.position.y)}, {round(o.position.z)})
                  {typeof o.hpCurrent === "number" && typeof o.hpMax === "number" && (
                    <> · hp {o.hpCurrent}/{o.hpMax}</>
                  )}
                  {o.origin === "duplicate" && <> · duplicate</>}
                </div>
              </li>
            ))}
            {selected.length > 8 && <li className="selection-list__more">…and {selected.length - 8} more</li>}
          </ul>
        </>
      )}
    </section>
  );
}

// Community figure (task brief), not derived from a calibration fixture —
// vertical build limit is said to be ~16 tiles (16 * VERTICAL_PITCH). Kept as
// its own named constant so the "unverified" caveat in the label and the
// number it's based on live next to each other.
const HEIGHT_LIMIT_TILES = 16;
const HEIGHT_LIMIT_UNITS = HEIGHT_LIMIT_TILES * VERTICAL_PITCH; // 5200

// Live, warn-don't-block radius check (CLAUDE.md §5/§11). Uses the palbox's
// LIVE position, not camp.position — the camp anchor follows the palbox at
// export, so a base moved during editing should be judged by where the
// palbox is now, not where it started. See src/scene/campGeometry.ts.
function RadiusGuardrail() {
  const objects = useEditorStore((s) => s.objects);
  const camp = useEditorStore((s) => s.camp);
  const setSelection = useEditorStore((s) => s.setSelection);
  const { palbox, reason } = findPalbox(objects);
  const multiplier = useRadiusStore((s) => s.multiplier);
  const setMultiplier = useRadiusStore((s) => s.setMultiplier);

  // Duplicate guardrail (Fix 3): memoized on `objects` identity alone —
  // doesn't need a palbox/camp, so it's computed and rendered unconditionally
  // even when the radius/height checks below are unavailable.
  const duplicateExtraIds = useMemo(() => findDuplicateClusters(objects).extraIds, [objects]);

  return (
    <section className="sidebar__section">
      <h3>Radius guardrail</h3>
      {!camp || !palbox ? (
        <p className="sidebar__empty">
          Radius check unavailable — {!camp ? "camp anchor/area_range not found for this file" : reason}.
        </p>
      ) : (
        (() => {
          // Modded-radius support: the count is judged against the scaled
          // radius, so a player running a radius-expanding mod isn't warned
          // about objects that are legal in their game. View-only — the
          // exported area_range is untouched (see radiusStore.ts).
          const radius = effectiveRadius(camp.areaRange, multiplier);
          const count = countOutsideRadius(objects, palbox.position, radius);
          // Height guardrail (task "3."): objects sitting more than
          // HEIGHT_LIMIT_UNITS above the LIVE palbox z — same "warn, don't
          // block" pattern and the same palbox-live-position rationale as
          // the radius check above.
          const aboveHeightCount = objects.reduce(
            (n, o) => (o.position.z - palbox.position.z > HEIGHT_LIMIT_UNITS ? n + 1 : n),
            0,
          );
          return (
            <>
              <div className={`radius-guardrail${count > 0 ? " radius-guardrail--warn" : ""}`}>
                <div className="radius-guardrail__row">
                  <span>Objects outside base radius</span>
                  <span className="radius-guardrail__count">{count}</span>
                </div>
                {count > 0 && (
                  <p className="radius-guardrail__warning">these may not import correctly — untested</p>
                )}
              </div>
              <div className="radius-multiplier">
                <label>
                  Radius ×
                  <input
                    type="number"
                    min={MIN_MULTIPLIER}
                    max={MAX_MULTIPLIER}
                    step={0.5}
                    value={multiplier}
                    onChange={(e) => setMultiplier(Number(e.target.value))}
                  />
                </label>
                <span className="radius-multiplier__readout">
                  {Math.round(radius)}uu{multiplier !== 1 && ` (base ${camp.areaRange})`}
                </span>
                <p className="sidebar__hint sidebar__hint--muted">
                  For base-radius mods. Affects this editor's warnings, ring and fill reach only — the exported file's
                  area_range is never changed.
                </p>
              </div>
              <div
                className={`radius-guardrail${aboveHeightCount > 0 ? " radius-guardrail--warn" : ""}`}
                style={{ marginTop: 8 }}
              >
                <div className="radius-guardrail__row">
                  <span>above ~{HEIGHT_LIMIT_TILES}-tile height limit (community figure, unverified)</span>
                  <span className="radius-guardrail__count">{aboveHeightCount}</span>
                </div>
              </div>
            </>
          );
        })()
      )}
      {/* Overlapping-duplicates guardrail (Fix 3) — N = objects beyond the
          first sharing typeId + position(50u) + facing-quadrant-for-thin-
          pieces (overlapCheck.ts's findDuplicateClusters, the same identity
          the interactive placement paths use to block NEW overlaps). "Select
          duplicates" selects exactly those extras, keeping one survivor per
          cluster, so Delete cleans them up in one step. */}
      <div
        className={`radius-guardrail${duplicateExtraIds.length > 0 ? " radius-guardrail--warn" : ""}`}
        style={{ marginTop: 8 }}
      >
        <div className="radius-guardrail__row">
          <span>Overlapping duplicates</span>
          <span className="radius-guardrail__count">{duplicateExtraIds.length}</span>
        </div>
        {duplicateExtraIds.length > 0 && (
          <>
            <p className="radius-guardrail__warning">
              {duplicateExtraIds.length} extra object{duplicateExtraIds.length === 1 ? "" : "s"} stacked on an
              existing same-type piece at the same spot — safe to delete.
            </p>
            <button type="button" onClick={() => setSelection(duplicateExtraIds)}>
              Select duplicates
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function WarningsSection() {
  const blueprint = useEditorStore((s) => s.blueprint);
  const loadError = useEditorStore((s) => s.loadError);
  const objects = useEditorStore((s) => s.objects);
  const unknownTypes = unknownDimensionTypes(objects);

  if (!loadError && (!blueprint || blueprint.warnings.length === 0) && unknownTypes.length === 0) return null;

  return (
    <section className="sidebar__section sidebar__section--warnings">
      <h3>Warnings</h3>
      <ul>
        {loadError && <li>{loadError}</li>}
        {blueprint?.warnings.map((w) => <li key={w}>{w}</li>)}
        {unknownTypes.map((u) => (
          <li key={u.typeId}>
            <span className="swatch" style={{ background: "#ff00ff" }} />
            {u.typeId} × {u.count} — {u.registered ? "no dimensions recorded" : "not in the type registry"}; preserved but no
            dimensions, rendered as a magenta box.
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Sidebar() {
  return (
    <div className="sidebar">
      <Palette />
      <CategoryCounts />
      <SelectionInfo />
      <RadiusGuardrail />
      <WarningsSection />
    </div>
  );
}
