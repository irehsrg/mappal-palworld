// Global keyboard interactions for the editor (arrow-key nudge, Q/E rotate,
// delete, undo/redo, duplicate, escape). Attached to `window` and only while
// a blueprint is loaded — see the `blueprint` guard below.
//
// Nudge and rotate both operate in Unreal space directly (not three.js
// space): they read/write PlacedObject.position/rotation as stored, and
// hand the result to transformObjects() in one call per key-press so each
// nudge/rotate is a single undo step, even for a multi-object selection.
import { useEffect } from "react";
import { useEditorStore, type TransformEdit } from "../model/store";
import { GRID_PITCH, VERTICAL_PITCH, type Quat } from "../model/types";
import { localAxesFromYaw, quatMultiply, yawFromQuat } from "./coords";
import { findPalbox } from "./campGeometry";
import { usePlaceModeStore } from "./placeModeStore";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function useKeyboardControls(): void {
  const blueprint = useEditorStore((s) => s.blueprint);
  const transformObjects = useEditorStore((s) => s.transformObjects);
  const deleteSelection = useEditorStore((s) => s.deleteSelection);
  const duplicateSelection = useEditorStore((s) => s.duplicateSelection);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setSelection = useEditorStore((s) => s.setSelection);

  useEffect(() => {
    // Disabled entirely when nothing is loaded — nothing to nudge/rotate/etc,
    // and we don't want to eat Ctrl+Z etc. on an empty page.
    if (!blueprint) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // Undo/redo and duplicate don't require a live selection read below,
      // but reading fresh state via getState() (rather than closing over
      // stale hook values) keeps this listener attachment stable across
      // renders — the effect only re-runs when `blueprint` changes.
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      if (ctrlOrCmd && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (ctrlOrCmd && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }

      if (ctrlOrCmd && (e.key === "a" || e.key === "A")) {
        // preventDefault so the browser doesn't select page text instead.
        e.preventDefault();
        const { objects } = useEditorStore.getState();
        setSelection(objects.map((o) => o.id));
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        // Place mode (CLAUDE.md §6) takes priority: the first Escape while
        // armed cancels placement, not selection — pressing Escape again
        // (now nothing is armed) clears selection as usual.
        if (usePlaceModeStore.getState().armedType) {
          usePlaceModeStore.getState().disarm();
          return;
        }
        clearSelection();
        return;
      }

      // "R" while armed (Phase 2 place mode, CLAUDE.md §6): cycles the ghost
      // rotation 0/90/180/270 — see placeModeStore.ts's ghostRotationSteps
      // and PlaceMode.tsx's snapLattice.ts usage for what each lattice kind
      // does with it. Checked ahead of the below "requires a live selection"
      // logic, since placing doesn't require anything selected; !ctrlOrCmd
      // keeps it out of the way of any future Ctrl+R browser-reload habit.
      if ((e.key === "r" || e.key === "R") && !ctrlOrCmd) {
        if (usePlaceModeStore.getState().armedType) {
          e.preventDefault();
          usePlaceModeStore.getState().rotateGhost();
          return;
        }
      }

      // PageUp/PageDown while armed (Phase 2 place mode, CLAUDE.md §6):
      // adjusts the ghost's levelOffset instead of nudging a selection —
      // armed mode takes precedence over the unarmed PageUp/PageDown case
      // further down (which moves the current selection). Checked ahead of
      // the "requires a live selection" logic for the same reason as "R"
      // above: placing doesn't require anything selected.
      //
      // Shift+PageUp/Shift+PageDown while armed (vertical stacking fast
      // path — see src/ui/VerticalStackPanel.tsx for the bulk-N version of
      // the same operation): stamps ONE copy of the armed type one
      // VERTICAL_PITCH above/below the last stamp, using that stamp's own
      // rotation, and advances lastStampPos/lastStampRotation to the piece
      // just placed — so repeated presses climb/descend a shaft one floor
      // per tap. A no-op (still preventDefault, so nothing else eats the
      // key) until at least one piece has been stamped this armed session:
      // there is no "last stamp" to stack from yet. Plain PageUp/PageDown
      // (no Shift) keeps its existing ghost-level-offset behavior below —
      // only the Shift variant stamps.
      if (e.key === "PageUp" || e.key === "PageDown") {
        if (usePlaceModeStore.getState().armedType) {
          e.preventDefault();
          if (e.shiftKey) {
            const { armedType, lastStampPos, lastStampRotation, setLastStamp } = usePlaceModeStore.getState();
            if (armedType && lastStampPos && lastStampRotation) {
              const dir = e.key === "PageUp" ? 1 : -1;
              const nextPos = { x: lastStampPos.x, y: lastStampPos.y, z: lastStampPos.z + dir * VERTICAL_PITCH };
              useEditorStore.getState().placeObject(armedType, nextPos, lastStampRotation);
              setLastStamp(nextPos, lastStampRotation);
            }
            return;
          }
          usePlaceModeStore.getState().adjustLevelOffset(e.key === "PageUp" ? 1 : -1);
          return;
        }
      }

      // "Tab" while armed (anchor-stability fix, placeModeStore.ts's
      // lockedAnchorId): toggles a lock on whatever PlaceMode.tsx's hover
      // last reported as the active anchor (hover.anchorId) — pins the
      // frame/z/cap so hovering near other pieces can't steal it, until Tab
      // is pressed again (or disarm/type-change, handled by
      // placeModeStore.ts's reset-on-arm-change). preventDefault so Tab
      // never moves focus off the canvas while placing. If nothing is
      // currently anchored (hover null, or anchorId undefined — e.g. no
      // palbox and nothing in range) there's nothing to lock onto; Tab is a
      // no-op rather than locking to "nothing".
      if (e.key === "Tab") {
        if (usePlaceModeStore.getState().armedType) {
          e.preventDefault();
          const { lockedAnchorId, hover, setAnchorLock } = usePlaceModeStore.getState();
          if (lockedAnchorId) {
            setAnchorLock(null);
          } else if (hover?.anchorId) {
            setAnchorLock(hover.anchorId);
          }
          return;
        }
      }

      // Shift+Q / Shift+E (radial symmetry gesture): rotates the ENTIRE
      // selection +-90 degrees about the PALBOX's position (vertical axis),
      // in one transformObjects() call — one undo step. Unlike plain Q/E
      // (below, in-place per-object rotation about each object's OWN
      // position), this orbits positions around a shared pivot AND applies
      // the same qz to each object's own rotation, so a wrap-around-the-
      // shaft assembly (pieces placed via repeated Q/E around a center)
      // rotates as a rigid body and lands exactly on the next side.
      //
      // Checked via e.shiftKey explicitly, not key casing: e.key is already
      // "Q" (not "q") whenever Shift is held, same as CapsLock — casing
      // alone can't distinguish "Shift+Q" from "q with CapsLock on", so the
      // plain Q/E case below (in-place rotate) matches BOTH cases and this
      // block must run first and return early to claim the Shift variant
      // before falling through.
      //
      // Pivot: the single PalBoxV2's position (x, y — z is untouched, see
      // below) when present; degrades to the selection's own centroid,
      // rounded to the nearest 200 on x/y (task brief — keeps the pivot
      // lattice-aligned so orbited positions don't drift off-grid), when
      // there's no unique palbox (none, or more than one — see
      // campGeometry.ts's findPalbox).
      //
      // Rotation math verified numerically (throwaway node script against
      // fixtures/calibration_01.json's foundations/palbox, not guessed):
      // rotating a position's (x,y) offset from the pivot by the standard
      // Rz(theta) matrix — newX = pivot.x + dx*cos(theta) - dy*sin(theta),
      // newY = pivot.y + dx*sin(theta) + dy*cos(theta) — is EXACTLY the
      // vector obtained by sandwich-rotating that offset with the same qz
      // quaternion used below for the object's own orientation (diff ~1e-14
      // at both +90 and -90), so position and rotation can never disagree.
      // Confirmed: 4x +90 round-trips positions with zero drift and returns
      // the identical rotation (quaternion double-cover: q_after ==
      // -q_before component-wise, |dot| == 1 — same rotation, not a bug);
      // 2x(+90)+2x(-90) round-trips with zero drift; and projecting 5
      // calibration foundations into the palbox's own local frame shows the
      // post-rotation residual-from-200 exactly equals
      // (old rr-residual, -old rf-residual) for every foundation (err
      // 0.0e+0) — i.e. a 90-degree group rotation about ANY pivot maps a
      // square lattice exactly onto itself, so this can never knock a
      // selection off its snap grid. Q uses theta=+90 (matches plain Q's qz
      // below exactly), E uses theta=-90 (matches plain E's qz exactly).
      if (!ctrlOrCmd && e.shiftKey && (e.key === "q" || e.key === "Q" || e.key === "e" || e.key === "E")) {
        const { objects: allObjects, selection: sel } = useEditorStore.getState();
        const selected = allObjects.filter((o) => sel.includes(o.id));
        if (selected.length === 0) return;
        e.preventDefault();

        const deg = e.key.toLowerCase() === "q" ? 90 : -90;
        const half = (deg * Math.PI) / 360; // (deg/2) in radians — same qz builder as plain Q/E below
        const qz: Quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

        const { palbox } = findPalbox(allObjects);
        const pivot = palbox
          ? { x: palbox.position.x, y: palbox.position.y }
          : {
              x: Math.round((selected.reduce((s, o) => s + o.position.x, 0) / selected.length) / 200) * 200,
              y: Math.round((selected.reduce((s, o) => s + o.position.y, 0) / selected.length) / 200) * 200,
            };

        const rad = (deg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const groupEdits: TransformEdit[] = selected.map((o) => {
          const relX = o.position.x - pivot.x;
          const relY = o.position.y - pivot.y;
          return {
            id: o.id,
            position: {
              x: pivot.x + relX * cos - relY * sin,
              y: pivot.y + relX * sin + relY * cos,
              z: o.position.z, // z stays — pivot rotation is about the vertical axis only
            },
            rotation: quatMultiply(qz, o.rotation),
          };
        });
        transformObjects(groupEdits); // one call = one undo step for the whole selection
        return;
      }

      const { objects, selection } = useEditorStore.getState();
      const selected = objects.filter((o) => selection.includes(o.id));

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.length === 0) return;
        e.preventDefault();
        deleteSelection();
        return;
      }

      if (ctrlOrCmd && (e.key === "d" || e.key === "D")) {
        if (selected.length === 0) return;
        e.preventDefault();
        // Offset one grid unit along the FIRST selected object's local
        // right axis, same convention as arrow-key nudging.
        const yaw = yawFromQuat(selected[0].rotation);
        const { right } = localAxesFromYaw(yaw);
        duplicateSelection({ x: right.x * GRID_PITCH, y: right.y * GRID_PITCH, z: 0 });
        return;
      }

      if (selected.length === 0) return;

      // Local grid axes come from the FIRST selected object's yaw — per the
      // task brief, nudges follow the selection's own grid, not world axes
      // (a base's grid can be rotated to an arbitrary yaw; see
      // docs/CALIBRATION.md "grid is NOT world-axis-aligned").
      const yaw = yawFromQuat(selected[0].rotation);
      const { forward, right } = localAxesFromYaw(yaw);

      let dx = 0;
      let dy = 0;
      let dz = 0;
      let rotateDeg = 0;
      let handled = true;

      switch (e.key) {
        case "ArrowUp":
          dx = forward.x * GRID_PITCH;
          dy = forward.y * GRID_PITCH;
          break;
        case "ArrowDown":
          dx = -forward.x * GRID_PITCH;
          dy = -forward.y * GRID_PITCH;
          break;
        case "ArrowRight":
          dx = right.x * GRID_PITCH;
          dy = right.y * GRID_PITCH;
          break;
        case "ArrowLeft":
          dx = -right.x * GRID_PITCH;
          dy = -right.y * GRID_PITCH;
          break;
        case "PageUp":
          dz = VERTICAL_PITCH;
          break;
        case "PageDown":
          dz = -VERTICAL_PITCH;
          break;
        case "q":
        case "Q":
          rotateDeg = 90;
          break;
        case "e":
        case "E":
          rotateDeg = -90;
          break;
        default:
          handled = false;
      }

      if (!handled) return;
      e.preventDefault();

      let edits: TransformEdit[];
      if (rotateDeg !== 0) {
        // In-place rotation about the world/Unreal-Z axis: q' = qz ⊗ q
        // (Hamilton product, qz applied on the left — a world-space
        // rotation stacked on top of whatever the object's current
        // orientation is). Position is untouched.
        const half = (rotateDeg * Math.PI) / 360; // (deg/2) in radians
        const qz: Quat = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
        edits = selected.map((o) => ({
          id: o.id,
          position: o.position,
          rotation: quatMultiply(qz, o.rotation),
        }));
      } else {
        edits = selected.map((o) => ({
          id: o.id,
          position: { x: o.position.x + dx, y: o.position.y + dy, z: o.position.z + dz },
          rotation: o.rotation,
        }));
      }
      // One transformObjects() call for the whole selection = one undo step.
      transformObjects(edits);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blueprint, transformObjects, deleteSelection, duplicateSelection, undo, redo, clearSelection, setSelection]);
}
