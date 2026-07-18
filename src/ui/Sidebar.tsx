// Right-hand panel: category counts (with swatches matching the scene's box
// colors), info about the current selection, a warnings panel (blueprint
// warnings + load error + unknown/magenta typeIds), and a keyboard
// cheat-sheet. Only shown once a blueprint is loaded (App.tsx).
import { useEditorStore } from "../model/store";
import { VERTICAL_PITCH } from "../model/types";
import { CATEGORY_COLOR, CATEGORY_LABEL, countByCategory, unknownDimensionTypes } from "../scene/objectTypes";
import { countOutsideRadius, findPalbox } from "../scene/campGeometry";
import { RelocateBasePanel } from "./RelocateBasePanel";
import { Palette } from "./Palette";
import { FillCirclePanel } from "./FillCirclePanel";
import { VerticalStackPanel } from "./VerticalStackPanel";

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

function SelectionInfo() {
  const objects = useEditorStore((s) => s.objects);
  const selection = useEditorStore((s) => s.selection);
  const selected = objects.filter((o) => selection.includes(o.id));

  return (
    <section className="sidebar__section">
      <h3>Selection</h3>
      {selected.length === 0 && <p className="sidebar__empty">Nothing selected. Click a box in the scene.</p>}
      {selected.length > 0 && (
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
  const { palbox, reason } = findPalbox(objects);

  return (
    <section className="sidebar__section">
      <h3>Radius guardrail</h3>
      {!camp || !palbox ? (
        <p className="sidebar__empty">
          Radius check unavailable — {!camp ? "camp anchor/area_range not found for this file" : reason}.
        </p>
      ) : (
        (() => {
          const count = countOutsideRadius(objects, palbox.position, camp.areaRange);
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

function KeyboardCheatSheet() {
  const shortcuts: [string, string][] = [
    ["Hold right-drag", "Fly (WASD move, Q/E down/up, Shift fast, scroll speed)"],
    ["Click / Shift-click", "Select / add to selection"],
    ["Click empty space", "Clear selection"],
    ["Arrow keys", "Nudge 1 grid unit (400cm) along selection's local axes"],
    ["PageUp / PageDown", "Move selection up/down 1 floor (325cm); while placing, adjusts the ghost's level instead"],
    ["Q / E", "Rotate ±90° about vertical axis (each object in place)"],
    ["Shift+Q / Shift+E", "Rotate the whole selection ±90° as a group, orbiting around the palbox (falls back to selection centroid if no single palbox)"],
    ["Delete / Backspace", "Delete selection"],
    ["Ctrl+D", "Duplicate selection"],
    ["Ctrl+A", "Select all"],
    ["Shift+drag empty space", "Box-select (adds to selection); disabled while placing"],
    ["Delete", "Delete selection — the palbox is always protected"],
    ["Ctrl+Z", "Undo"],
    ["Ctrl+Y / Ctrl+Shift+Z", "Redo"],
    ["Escape", "Stop placing, else clear selection"],
    ["Palette button", "Arm/disarm place mode for that object"],
    ["Click (while placing)", "Stamp a piece; stays armed for repeats"],
    ["R (while placing)", "Rotate ghost +90°; for walls, breaks a tie near a corner"],
    ["PageUp / PageDown (while placing)", "Raise/lower the ghost 1 level (325cm); hovering a roof/foundation near a wall defaults to capping it"],
    ["Tab (while placing)", "Lock/unlock the active anchor — freezes frame + level on a dense build; Tab again, Escape, or switching type unlocks"],
    ["Alt (while placing)", "Disable grid snap for that placement"],
    ["Shift+click (while placing)", "Fill a line from the last stamp to here, at the ghost's current level"],
    ["Ctrl+Shift+click (while placing)", "Fill a rectangle from the last stamp to here, at the ghost's current level"],
    ["Shift+PageUp / Shift+PageDown (while placing)", "Stamp one copy of the armed type a floor above/below the last stamp (325cm)"],
  ];
  return (
    <section className="sidebar__section">
      <h3>Keyboard</h3>
      <dl className="cheat-sheet">
        {shortcuts.map(([key, desc]) => (
          <div key={key} className="cheat-sheet__row">
            <dt>{key}</dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Sidebar() {
  return (
    <div className="sidebar">
      <Palette />
      <FillCirclePanel />
      <VerticalStackPanel />
      <CategoryCounts />
      <SelectionInfo />
      <RadiusGuardrail />
      <RelocateBasePanel />
      <WarningsSection />
      <KeyboardCheatSheet />
    </div>
  );
}
