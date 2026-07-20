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
import { clampMultiplier, useRadiusStore } from "../scene/radiusStore";
import { findPalbox } from "../scene/campGeometry";
import { getTypeEntry } from "../scene/objectTypes";
import { localAxesFromYaw, yawFromQuat } from "../scene/coords";
import { addToOverlapIndex, buildOverlapIndex, findOverlap } from "../scene/overlapCheck";
import type { PlacedObject } from "../model/types";
import { GRID_PITCH } from "../model/types";

const DEFAULT_RADIUS_TILES = 8;
/** Vanilla cap: a radius-9 disk of 400uu tiles just covers the 3500uu base
 *  radius. Scaled by the user's radius multiplier so base-radius mods can
 *  actually fill what they can build on — see scene/radiusStore.ts. */
const MAX_RADIUS_TILES_VANILLA = 9;
/** Hard cap on pieces placed by one Fill click — same idea as arrayStamp.ts's MAX_STAMP_COUNT, just a bigger budget since a radius-9 disk (~254 tiles, πr²) can exceed that 200 cap. Scales with the radius multiplier (area grows as r²) so a modded fill isn't silently truncated; the panel reports when it does cap. */
const MAX_FILL_COUNT_VANILLA = 400;

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
  const multiplier = useRadiusStore((s) => s.multiplier);

  const [radiusStr, setRadiusStr] = useState(String(DEFAULT_RADIUS_TILES));
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Radius scales linearly with the multiplier; the piece budget scales with
  // area (r²) so the bigger disk isn't cut off partway through.
  const maxRadiusTiles = Math.round(MAX_RADIUS_TILES_VANILLA * clampMultiplier(multiplier));
  const maxFillCount = Math.round(MAX_FILL_COUNT_VANILLA * clampMultiplier(multiplier) ** 2);

  const parsedRadius = Number(radiusStr);
  const radius = Number.isFinite(parsedRadius)
    ? Math.min(maxRadiusTiles, Math.max(1, Math.round(parsedRadius)))
    : DEFAULT_RADIUS_TILES;

  const isFoundation = !!armedType && armedType.toLowerCase().includes("foundation");
  const armedName = armedType ? (getTypeEntry(armedType)?.name ?? armedType) : null;

  const handleFill = () => {
    if (!palbox || !armedType || !isFoundation) return;
    const centers = circleTileCenters(palbox, radius);
    const z = palbox.position.z;
    // Overlap prevention (Fix 2): same same-typeId/OVERLAP_TOLERANCE dedup
    // as every other placement path (see overlapCheck.ts) — this panel used
    // to roll its own "already covered" check; now shares the one
    // definition. Built once from the LIVE store and topped up with each
    // newly-placed tile so re-running the tool never double-places within
    // the same click either.
    const index = buildOverlapIndex(objects);
    let placed = 0;
    let skipped = 0;
    for (const { x, y } of centers) {
      if (placed >= maxFillCount) break;
      const position = { x, y, z };
      if (findOverlap(index, armedType, position, palbox.rotation)) {
        skipped++;
        continue;
      }
      placeObject(armedType, position, palbox.rotation);
      addToOverlapIndex(index, { id: "", typeId: armedType, position, rotation: palbox.rotation, scale: { x: 1, y: 1, z: 1 }, origin: "placed" });
      placed++;
    }
    const cappedNote = placed >= maxFillCount && placed < centers.length ? ` (capped at ${maxFillCount})` : "";
    setLastResult(`placed ${placed} tile${placed === 1 ? "" : "s"}, skipped ${skipped} overlapping${cappedNote}`);
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
                max={maxRadiusTiles}
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
