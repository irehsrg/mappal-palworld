// Sidebar panel: "Fill base circle" — the platform generator (UX task "2.").
// Bulk-stamps a full ring-of-tiles platform in one click, in the PALBOX's own
// grid frame (not whatever structure happens to be nearest — a platform
// generator should always be anchored to the base itself), so a mega-base's
// foundation layer doesn't have to be laid one tile at a time via the
// palette + array-stamp fill.
//
// Deliberately its own placeObject() loop rather than reusing arrayStamp.ts's
// line/rect fill: this is a 2D disk of tiles (not a line/rectangle between
// two clicked points), generated from the palbox position alone with no
// pointer interaction at all — a different shape of tool, sharing only the
// "loop placeObject(), one undo step per piece" mechanics (documented
// limitation, same as array-stamp — see Palette.tsx's armed-hint copy).
import { useState } from "react";
import { useEditorStore } from "../model/store";
import { usePlaceModeStore } from "../scene/placeModeStore";
import { findPalbox } from "../scene/campGeometry";
import { getTypeEntry } from "../scene/objectTypes";
import { localAxesFromYaw, yawFromQuat } from "../scene/coords";
import type { PlacedObject } from "../model/types";
import { GRID_PITCH } from "../model/types";

const DEFAULT_RADIUS_TILES = 8;
const MAX_RADIUS_TILES = 9;
/** Hard cap on pieces placed by one Fill click — same idea as arrayStamp.ts's MAX_STAMP_COUNT, just a bigger budget since a radius-9 disk (~254 tiles, πr²) can exceed that 200 cap. */
const MAX_FILL_COUNT = 400;
/** A tile is considered "already covered" if an existing object of the SAME typeId sits within this horizontal distance and z tolerance — task brief, so re-running the tool tops up gaps instead of doubling up on tiles already placed. */
const EXISTING_TOLERANCE = 50;

/**
 * Tile-center positions in the palbox's own grid frame (task brief formula):
 * for integer i, j in [-radius-1, radius], center = palboxPos +
 * ((i+0.5)*GRID_PITCH)*forward + ((j+0.5)*GRID_PITCH)*right, keeping only
 * tiles whose horizontal distance from the palbox is <= radius*GRID_PITCH.
 * This yields the symmetric circle-of-squares with the palbox sitting at a
 * 4-tile corner intersection (matches the in-game screenshot referenced in
 * the task brief). z and rotation are NOT part of this list — callers use
 * the palbox's z/rotation directly, same for every tile.
 */
function circleTileCenters(palbox: PlacedObject, radiusTiles: number): { x: number; y: number }[] {
  const yaw = yawFromQuat(palbox.rotation);
  const { forward, right } = localAxesFromYaw(yaw);
  const maxDist = radiusTiles * GRID_PITCH;
  const tiles: { x: number; y: number }[] = [];
  for (let i = -(radiusTiles + 1); i <= radiusTiles; i++) {
    for (let j = -(radiusTiles + 1); j <= radiusTiles; j++) {
      const localX = (i + 0.5) * GRID_PITCH;
      const localY = (j + 0.5) * GRID_PITCH;
      // forward/right are an orthonormal pair, so the rotated offset's
      // length is just hypot(localX, localY) — no need to materialize the
      // rotated x/y first to test the radius.
      if (Math.hypot(localX, localY) > maxDist) continue;
      tiles.push({
        x: palbox.position.x + localX * forward.x + localY * right.x,
        y: palbox.position.y + localX * forward.y + localY * right.y,
      });
    }
  }
  return tiles;
}

export function FillCirclePanel() {
  const objects = useEditorStore((s) => s.objects);
  const placeObject = useEditorStore((s) => s.placeObject);
  const armedType = usePlaceModeStore((s) => s.armedType);
  const { palbox, reason } = findPalbox(objects);

  const [radiusStr, setRadiusStr] = useState(String(DEFAULT_RADIUS_TILES));
  const [lastResult, setLastResult] = useState<string | null>(null);

  const parsedRadius = Number(radiusStr);
  const radius = Number.isFinite(parsedRadius)
    ? Math.min(MAX_RADIUS_TILES, Math.max(1, Math.round(parsedRadius)))
    : DEFAULT_RADIUS_TILES;

  const isFoundation = !!armedType && armedType.toLowerCase().includes("foundation");
  const armedName = armedType ? (getTypeEntry(armedType)?.name ?? armedType) : null;

  const handleFill = () => {
    if (!palbox || !armedType || !isFoundation) return;
    const centers = circleTileCenters(palbox, radius);
    const z = palbox.position.z;
    let placed = 0;
    let skipped = 0;
    for (const { x, y } of centers) {
      if (placed >= MAX_FILL_COUNT) break;
      const alreadyCovered = objects.some(
        (o) =>
          o.typeId === armedType &&
          Math.hypot(o.position.x - x, o.position.y - y) <= EXISTING_TOLERANCE &&
          Math.abs(o.position.z - z) <= EXISTING_TOLERANCE,
      );
      if (alreadyCovered) {
        skipped++;
        continue;
      }
      placeObject(armedType, { x, y, z }, palbox.rotation);
      placed++;
    }
    const cappedNote = placed >= MAX_FILL_COUNT && placed < centers.length ? ` (capped at ${MAX_FILL_COUNT})` : "";
    setLastResult(`placed ${placed} tile${placed === 1 ? "" : "s"}, skipped ${skipped} existing${cappedNote}`);
  };

  return (
    <section className="sidebar__section">
      <h3>Base circle</h3>
      {!palbox ? (
        <p className="sidebar__empty">Fill unavailable — {reason}.</p>
      ) : (
        <>
          <p className="sidebar__hint">
            Fills a circular platform of tiles centred on the palbox, on the palbox's own grid. Re-running tops up
            gaps without doubling existing tiles.
          </p>
          <div className="relocate-form">
            <label>
              Radius (tiles)
              <input
                type="number"
                min={1}
                max={MAX_RADIUS_TILES}
                value={radiusStr}
                onChange={(e) => setRadiusStr(e.target.value)}
              />
            </label>
          </div>
          <button type="button" onClick={handleFill} disabled={!isFoundation}>
            Fill circle with {armedName ?? "foundation"}
          </button>
          {!isFoundation && <p className="sidebar__hint sidebar__hint--muted">arm a foundation type first</p>}
          {lastResult && <p className="sidebar__hint sidebar__hint--muted">{lastResult}</p>}
        </>
      )}
    </section>
  );
}
