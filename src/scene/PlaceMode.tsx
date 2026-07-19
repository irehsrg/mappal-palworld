// Phase 2 "place new object" interaction (CLAUDE.md §6): the ghost preview
// and its raycast/snap math. Rendered inside <Canvas> (Scene.tsx) whenever
// something is armed via the palette (src/ui/Palette.tsx).
//
// This component does NOT handle the actual placement click — that's owned
// by Scene.tsx's onPointerMissed and ObjectBox.tsx's onClick, so armed mode
// can hijack "click on empty space" and "click on an existing object" alike
// without this component needing a full-viewport invisible hit-test plane of
// its own. Those two call sites just read `usePlaceModeStore.getState()` at
// click time and use whatever `hover` this component last computed — see
// placeModeStore.ts's header for the full list of consumers.
//
// Raycasting is done with a native `pointermove` listener on the canvas DOM
// element (same technique as MarqueeSelect.tsx) rather than R3F's per-mesh
// pointer events, for two reasons: (1) the ghost must track the pointer even
// when the pointer isn't over any existing mesh — a plain ground hit — and
// (2) the native PointerEvent gives us `e.altKey` directly for the
// free-placement modifier, no separate key-tracking needed.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Html, Outlines } from "@react-three/drei";
import type { PlacedObject, Quat, Vec3 } from "../model/types";
import { GRID_PITCH, VERTICAL_PITCH } from "../model/types";
import { usePlaceModeStore } from "./placeModeStore";
import { findPalbox } from "./campGeometry";
import { getTypeEntry, resolveType } from "./objectTypes";
import { getProxyGeometry } from "./proxyGeometry";
import {
  UNIT_SCALE,
  localAxesFromYaw,
  threeDirToUe,
  threeVecToUe,
  ueQuatToThree,
  ueVecToThree,
  yawFromQuat,
} from "./coords";
import { computeStampFill, stampFillNewCount, stampModeFromModifiers } from "./arrayStamp";
import {
  classifyLattice,
  edgeYawOffsetDeg,
  isGridAlignedYaw,
  rotateQuatByDeg,
  snapCenterLattice,
  snapCornerLattice,
  snapEdgeLattice,
} from "./snapLattice";
import { useVisibilityStore } from "./visibilityStore";

export interface PlaceModeProps {
  objects: PlacedObject[];
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
}

/** No palbox in this file: fall back to world origin/identity rotation as the "base grid" anchor — see file header and CLAUDE.md §6 (donor placement still works without a palbox, it just can't inherit a base's yaw). */
const WORLD_ANCHOR: Vec3 = { x: 0, y: 0, z: 0 };
const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

// Anchor-stability tuning (placement UX fix: on a dense multi-level build the
// ghost used to flicker between adjacent structures/levels because the
// active anchor was re-picked from scratch, as the raw nearest structure,
// every single pointermove — see the "ANCHOR SELECTION" block in
// onPointerMove below for how these combine).
/** Horizontal search radius (UE units) for anchor candidates. */
const SNAP_SEARCH_RADIUS = 1200;
/** A candidate only steals the anchor from the current one when its scored distance beats the current's by this ratio (lower = harder to steal = less flapping). */
const HYSTERESIS_SWITCH_RATIO = 0.6;
/** Anchor selection is skipped entirely unless the pass-1 hit has moved this many UE units since it was last (re)evaluated — absorbs pixel-level cursor jitter. */
const REEVAL_DAMP_DIST = 100;
/** Effective-distance penalty added to a candidate whose target level differs from the current target level by more than LEVEL_TOLERANCE — keeps a level-2 build from snapping to level-1 pieces just because they're horizontally closer. */
const LEVEL_PENALTY = 800;
/** UE units of Z difference still considered "the same level" for the penalty above. */
const LEVEL_TOLERANCE = 50;

// --- Vertical-placement overhaul tuning (object-geometry raycast) ---------
/**
 * Bound on THREE.Raycaster.far for the placed-object hit-test, in three.js
 * scene units (metres — see coords.ts's UNIT_SCALE). Generous enough to
 * reach any realistic base (a mega-base a few hundred metres across is
 * already extreme) while still giving the raycaster a real bound instead of
 * the default Infinity, per the task brief's "set raycaster.far sensibly".
 */
const OBJECT_RAYCAST_FAR = 3000;
/** Epsilon (UE units) below which a face's classified target Z is considered "already on the right plane" — skips the redundant pass-2 re-raycast. */
const TARGET_Z_EPSILON = 1e-6;
/** Radius (metres) of the small height-reference ring drawn around the ghost — ~3 tiles wide (GRID_PITCH is one tile), per the task brief ("small, ~3 tiles wide, not a full-scene plane"). */
const LEVEL_RING_RADIUS_M = 1.5 * GRID_PITCH * UNIT_SCALE;

export function PlaceMode({ objects, centroidThree }: PlaceModeProps) {
  const { camera, gl, scene } = useThree();
  const armedType = usePlaceModeStore((s) => s.armedType);
  const hover = usePlaceModeStore((s) => s.hover);
  // Overlap-prevention fix: transient "already placed here" / "placed N,
  // skipped M overlapping" message — see placeModeStore.ts's setFeedback and
  // overlapCheck.ts. Rendered below, next to the ghost.
  const feedback = usePlaceModeStore((s) => s.feedback);
  // Subscribed purely to drive the "forced recompute" effect below (stale-
  // ghost fix: R / PageUp/PageDown / Tab while armed used to leave the ghost
  // showing the PREVIOUS rotation/level/anchor until the cursor physically
  // crossed a tile, because hover was only ever recomputed inside the native
  // pointermove listener — these key presses don't fire one). The values
  // themselves are read fresh from usePlaceModeStore.getState() inside
  // computeHover (see below); these subscriptions exist only to fire the
  // effect, not to feed values into the computation directly.
  const ghostRotationSteps = usePlaceModeStore((s) => s.ghostRotationSteps);
  const levelOffset = usePlaceModeStore((s) => s.levelOffset);
  const lockedAnchorId = usePlaceModeStore((s) => s.lockedAnchorId);

  // Read via refs inside the native listener (same technique as
  // MarqueeSelect.tsx) so a moving palbox / edited object list is always
  // seen by the very next pointermove without needing to reattach the
  // listener on every store update.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const centroidRef = useRef(centroidThree);
  centroidRef.current = centroidThree;

  // Flat array of every PLACED object's mesh (tagged by ObjectBox.tsx's
  // userData.isPlacedObject), for the "raycast the actual placed geometry
  // FIRST" hover pass below — see computeHover's object-raycast block.
  // Rebuilt only when the object LIST changes (this effect's dependency),
  // never per pointermove/frame: a THREE.Raycaster against a few thousand
  // meshes is cheap per call, but re-walking the whole scene graph with
  // scene.traverse() to FIND those meshes on every mouse pixel would not be.
  // scene.traverse() (rather than keeping a live registry any other way) is
  // safe here because R3F commits host-tree mutations (mesh insertion into
  // the three.js scene graph) synchronously during React's commit phase —
  // by the time ANY effect for this same commit runs (this one included),
  // every ObjectBox mesh for the current `objects` is already attached,
  // regardless of this effect's position relative to ObjectBox's own.
  const placedMeshesRef = useRef<THREE.Object3D[]>([]);
  // Levels panel visibility lens (src/ui/LevelsPanel.tsx,
  // visibilityStore.ts): a hidden/soloed-out object's ObjectBox unmounts
  // entirely (returns null), so it's already absent from scene.traverse()
  // below by construction — but only once THIS effect re-runs and re-walks
  // the scene graph. Subscribing to hiddenLevels/soloLevel here (in addition
  // to objects/scene) is what forces that re-walk on every hide/solo toggle;
  // without it, a level hidden mid-session would still block placement
  // raycasts against its now-invisible meshes until the next unrelated
  // object edit happened to re-run this effect.
  const hiddenLevels = useVisibilityStore((s) => s.hiddenLevels);
  const soloLevel = useVisibilityStore((s) => s.soloLevel);
  useEffect(() => {
    const meshes: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if ((obj.userData as { isPlacedObject?: boolean }).isPlacedObject) meshes.push(obj);
    });
    placedMeshesRef.current = meshes;
  }, [objects, scene, hiddenLevels, soloLevel]);

  // Seeds the ground-plane height for the FIRST raycast pass each pointer
  // move (see onPointerMove below) — without a decent guess we'd have to
  // raycast against some arbitrary plane before we even know which anchor
  // is active. Persists frame-to-frame (not reset on re-arm) since "last
  // known anchor Z" is still a reasonable guess for the next frame even
  // across a re-arm; it self-corrects within one pointermove regardless.
  const lastAnchorZRef = useRef<number | null>(null);
  // Latest raw pointermove event (stale-ghost fix, see the ghostRotationSteps
  // subscription comment above): computeHover reads every input it needs
  // (clientX/Y, altKey, shiftKey, ctrlKey) off a PointerEvent, so storing the
  // event itself is enough to replay the exact same computation later with
  // fresh store state, no need to duplicate its fields into a separate shape.
  // Null until the first real pointermove of this armed session.
  const lastPointerEventRef = useRef<PointerEvent | null>(null);
  // The current effect run's computeHover closure (rebuilt every time the
  // effect below re-runs, i.e. on armed/camera/gl change) — stashed here so
  // the SECOND effect (forced-recompute-on-key-change, declared after this
  // one) can call it without itself needing to duplicate any raycasting
  // state. Always non-null by the time the second effect can possibly fire
  // for a given armed session (both effects list `armedType`, and this one
  // is declared first, so React finishes rebuilding this one first).
  const computeHoverRef = useRef<((e: PointerEvent, force: boolean) => void) | null>(null);

  // Effect re-attaches whenever armed state flips so we can cleanly clear the
  // hover on disarm (and skip listening entirely while nothing is armed).
  useEffect(() => {
    if (!armedType) {
      usePlaceModeStore.getState().setHover(null);
      return;
    }
    // Narrowed, non-null local: onPointerMove below is a nested function
    // (invoked later, asynchronously, via addEventListener) so TS can't
    // carry the `if (!armedType)` narrowing above across that closure
    // boundary on its own — capture the narrowed value once instead.
    const armed: string = armedType;

    const dom = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitThree = new THREE.Vector3();

    // Anchor-stability state (hysteresis + damped re-evaluation, see the
    // "ANCHOR SELECTION" block below). Plain closure variables, not refs:
    // like raycaster/ndc/hitThree above, they only need to persist across
    // pointermoves WITHIN this armed session — this effect reattaches (and
    // these get freshly reset) on every arm/disarm/type change, which is
    // exactly when we want anchor tracking to start over anyway.
    let currentAnchorId: string | null = null;
    let lastEvalPoint: { x: number; y: number } | null = null;

    // Extracted from the pointermove listener (stale-ghost fix) so it can be
    // invoked from two places: a real pointermove (force=false, normal
    // anchor-reevaluation damping applies) and the forced-recompute effect
    // below, replaying the LAST pointer event whenever ghostRotationSteps /
    // levelOffset / lockedAnchorId / armedType changes without the cursor
    // itself moving (force=true, damping bypassed — see the "movedEnough"
    // line for exactly what that skips).
    function computeHover(e: PointerEvent, force: boolean) {
      // Named distinctly from the component's own `objects` prop (which this
      // closure must NOT read — see the refs comment above) to avoid any
      // accidental shadowing confusion.
      const liveObjects = objectsRef.current;
      const { palbox } = findPalbox(liveObjects);
      // Palbox-frame fallback (used when no other structure is in range, or
      // when there's no palbox at all — world origin/identity, so placement
      // still works, just unsnapped-to-any-base, rather than being unusable).
      const palboxAnchorUE: Vec3 = palbox ? palbox.position : WORLD_ANCHOR;
      const palboxRotation: Quat = palbox ? palbox.rotation : IDENTITY_QUAT;

      const rect = dom.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      // Bound the object hit-test below (task brief's "set raycaster.far
      // sensibly") — see OBJECT_RAYCAST_FAR's own comment. Harmless to set
      // unconditionally: raycastAtZ below hits a THREE.Plane directly via
      // raycaster.ray, which doesn't consult .far at all.
      raycaster.far = OBJECT_RAYCAST_FAR;

      // Raycast the pointer against a horizontal plane at a given UE z,
      // returning the hit in UE space (or null if the ray is parallel to
      // the plane, e.g. camera looking at the horizon). Ground plane is in
      // the scene's recentred three.js space: UE z converted to three-Y,
      // minus the same centroid offset every rendered object is placed with
      // (Scene.tsx / ObjectBox.tsx).
      function raycastAtZ(zUE: number): Vec3 | null {
        const planeHeightThree = zUE * UNIT_SCALE - centroidRef.current.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeightThree);
        const hit = raycaster.ray.intersectPlane(plane, hitThree);
        if (!hit) return null;
        return threeVecToUe(hitThree.clone().add(centroidRef.current));
      }

      // Tab-lock resolution, moved ahead of everything else (vertical-
      // placement overhaul): the object-raycast block just below must know
      // whether we're locked BEFORE it runs, since a lock wins outright —
      // see that block's own comment. Previously this lived inside the
      // "ANCHOR SELECTION" block further down; it's the same logic, just
      // hoisted so both the new object-raycast path and the old fallback
      // path (still below, now gated on `!objectHitApplied`) can share it.
      const { lockedAnchorId } = usePlaceModeStore.getState();
      let lockedObj: PlacedObject | null = null;
      if (lockedAnchorId) {
        lockedObj = liveObjects.find((o) => o.id === lockedAnchorId) ?? null;
        if (!lockedObj) {
          // Locked object no longer exists (deleted, or undone away) —
          // auto-unlock rather than silently freezing on a ghost forever.
          usePlaceModeStore.getState().setAnchorLock(null);
        }
      }

      // Per-type snap lattice (bug fix, docs/CALIBRATION.md "Wall placement"):
      // walls/fences/gates sit on tile EDGES, pillars on tile CORNERS, and
      // everything else (foundations, roofs, furniture, unknown-dims types)
      // keeps the original tile-CENTER lattice — see snapLattice.ts's header
      // for the numeric derivation of the EDGE yaw convention. Computed here
      // (ahead of anchor selection, not just for the snap math below)
      // because targetZFor's wall-cap rule, used for level-preference
      // scoring during the FALLBACK anchor search below, needs it too.
      const armedSize = resolveType(armed).size;
      const lattice = classifyLattice(armedSize);
      const ghostRotationSteps = usePlaceModeStore.getState().ghostRotationSteps;

      // Smart cap default (vertical-placement fix, "cap the wall") + armed-
      // mode level offset (PageUp/PageDown while armed), combined: given an
      // anchor's raw z/typeId, returns whether the wall-cap rule fired and
      // the final target z (cap, then + levelOffset*VERTICAL_PITCH stacked
      // on top — "cap this wall, then go up 2 more floors" composes).
      // FALLBACK-PATH ONLY now (see the object-raycast block below for its
      // replacement, face-hit-driven equivalent): when the pointer isn't
      // over any placed object's actual geometry, we're back to guessing
      // "on top of" vs. "next to" from anchor-type + armed-type alone, which
      // is exactly what this heuristic was built for — unchanged from
      // before this overhaul.
      function targetZFor(anchorZ: number, anchorTypeId: string | null): { capActive: boolean; targetZ: number } {
        const anchorLattice = anchorTypeId ? classifyLattice(resolveType(anchorTypeId).size) : null;
        const isArmedSlab = lattice === "center" && armedSize[0] >= 300 && armedSize[1] >= 300;
        const capActive = anchorLattice === "edge" && isArmedSlab;
        const baseAnchorZ = capActive ? anchorZ + VERTICAL_PITCH : anchorZ;
        const { levelOffset } = usePlaceModeStore.getState();
        return { capActive, targetZ: baseAnchorZ + levelOffset * VERTICAL_PITCH };
      }

      let nearest: PlacedObject | null = null;
      let anchorUE: Vec3 = palboxAnchorUE;
      let rotation: Quat = palboxRotation;
      let capActive = false;
      let targetZ = palboxAnchorUE.z;
      let hitUE: Vec3 | null = null;
      let objectHitApplied = false;

      // ====================================================================
      // RAYCAST THE PLACED GEOMETRY FIRST (vertical-placement overhaul): aim
      // directly at an object's mesh — not an abstract "nearest structure in
      // range" search — and read the actual FACE that was hit to decide
      // "on top of this" vs. "beside this" vs. "underneath this". Skipped
      // entirely while Tab-locked: a lock is a promise that nothing (not
      // even where the pointer is actually pointing) moves the anchor.
      // ====================================================================
      if (!lockedObj) {
        const hits = raycaster.intersectObjects(placedMeshesRef.current, false);
        const hit = hits[0];
        const hitObj = hit ? (hit.object.userData as { placedObject?: PlacedObject }).placedObject ?? null : null;
        if (hit && hit.face && hitObj) {
          // Face normal is stored in the mesh's LOCAL space — transform by
          // the mesh's world matrix to get a world-space (three.js) normal,
          // then swap axes into UE space (coords.ts's threeDirToUe) so "up"
          // reliably means "+UE-Z" regardless of the object's own yaw.
          const worldNormalThree = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          const n = threeDirToUe(worldNormalThree);
          const horizMag = Math.hypot(n.x, n.y);
          // Dominant-axis classification (task brief): a normal whose
          // vertical component outweighs its horizontal one is a top/bottom
          // face; otherwise it's a side face. No dead-zone/epsilon needed —
          // every proxy shape here is either axis-aligned (box faces are
          // exactly vertical or exactly horizontal) or a shallow roof slope
          // whose horizontal component dominates on purpose (a roof's slanted
          // face should read as "side", not "top", so placing next to a roof
          // doesn't get mistaken for placing on its ridge).
          const faceKind: "top" | "side" | "bottom" = Math.abs(n.z) > horizMag ? (n.z > 0 ? "top" : "bottom") : "side";

          const hitLattice = classifyLattice(resolveType(hitObj.typeId).size);
          const hitIsThin = hitLattice === "edge" || hitLattice === "corner";
          let baseZ: number;
          if (faceKind === "top") {
            // Top of a wall/pillar (edge/corner lattice): the walkable
            // surface is one floor ABOVE the piece itself — go up a level.
            // Top of a foundation/roof/furniture (center lattice): the
            // piece's own top face already IS the walkable plane — same
            // level. (Task brief, verbatim.)
            baseZ = hitIsThin ? hitObj.position.z + VERTICAL_PITCH : hitObj.position.z;
            capActive = hitIsThin;
          } else if (faceKind === "bottom") {
            // Underneath any piece: one level below it.
            baseZ = hitObj.position.z - VERTICAL_PITCH;
          } else {
            // Side face: same level as the piece hit, adjacent cell in
            // whichever direction the hit point actually landed — the
            // shared snap-math block below derives that cell directly from
            // the real intersection point (hitUE), so no separate "which
            // direction" computation is needed here.
            baseZ = hitObj.position.z;
          }
          const { levelOffset } = usePlaceModeStore.getState();
          targetZ = baseZ + levelOffset * VERTICAL_PITCH;

          nearest = hitObj;
          anchorUE = hitObj.position;
          rotation = hitObj.rotation;
          hitUE = threeVecToUe(hit.point.clone().add(centroidRef.current));
          objectHitApplied = true;

          // Keep the fallback path's hysteresis state in sync: if the very
          // next pointermove sails off the edge of this mesh (no object
          // hit), the fallback anchor search below should pick up smoothly
          // from here instead of re-searching cold and risking a visible
          // jump to a different, merely-nearby, structure.
          currentAnchorId = hitObj.id;
          lastEvalPoint = { x: hitObj.position.x, y: hitObj.position.y };
        }
      }

      // ====================================================================
      // FALLBACK: object raycast missed (open ground/sky) or we're locked —
      // CURRENT behavior, unchanged: plane raycast + nearest-structure
      // anchor search + hysteresis (task brief's "2.").
      // ====================================================================
      if (!objectHitApplied) {
        // Pass 1: raycast at our best guess of the active anchor's Z (last
        // frame's anchor, or the palbox as a first-ever guess) just to get an
        // approximate XY — good enough to search for a nearby structure below.
        // This resolves the chicken-and-egg problem of "which anchor sets the
        // plane height" vs "the anchor search needs a hit point": a stacked
        // foundation one floor up will correct itself in pass 2 (below) once
        // we know it's the active anchor, so being one floor off for the
        // search itself doesn't matter — horizontal distance is all pass 1 needs.
        const approxHitUE = raycastAtZ(lastAnchorZRef.current ?? palboxAnchorUE.z);
        if (!approxHitUE) {
          usePlaceModeStore.getState().setHover(null);
          return;
        }

        // ANCHOR SELECTION (anchor-stability fix — "the ghost spazzes out":
        // flickers between levels and jumps across snap areas as the cursor
        // moves on a dense build). Two layers, checked in order (the lock
        // itself was already resolved above, ahead of the object raycast):
        //  1. Anchor lock (Tab — placeModeStore.ts's lockedAnchorId,
        //     useKeyboardControls.ts): skips everything below, frame/z/cap
        //     all come from the locked object alone.
        //  2. Damped re-evaluation + hysteresis + level preference: the
        //     search only runs when the pass-1 hit has moved more than
        //     REEVAL_DAMP_DIST since the anchor was last evaluated; when it
        //     does run, every in-range structure is scored by horizontal
        //     distance, +LEVEL_PENALTY if its target level (via targetZFor
        //     above) differs from the CURRENT anchor's target level by more
        //     than LEVEL_TOLERANCE — this is what keeps a level-2 pass
        //     snapping to level-2 pieces instead of a horizontally-nearer
        //     ground piece. The current anchor is kept unless a candidate's
        //     scored distance beats it by the HYSTERESIS_SWITCH_RATIO margin —
        //     no flapping between two roughly-equidistant/co-level pieces.
        const structures = liveObjects.filter((o) => resolveType(o.typeId).category === "structure");

        if (lockedObj) {
          nearest = lockedObj; // locked: selection skipped entirely, hysteresis state below untouched
        } else {
          const currentObj = currentAnchorId ? (structures.find((o) => o.id === currentAnchorId) ?? null) : null;
          const refAnchor = currentObj
            ? { z: currentObj.position.z, typeId: currentObj.typeId as string | null }
            : { z: palboxAnchorUE.z, typeId: palbox?.typeId ?? null };
          const refZ = targetZFor(refAnchor.z, refAnchor.typeId).targetZ;

          const effectiveDist = (o: PlacedObject, horizDist: number): number => {
            const z = targetZFor(o.position.z, o.typeId).targetZ;
            return Math.abs(z - refZ) > LEVEL_TOLERANCE ? horizDist + LEVEL_PENALTY : horizDist;
          };

          // `force` (stale-ghost fix: a forced recompute replaying the exact
          // same pointer event after e.g. R changed ghostRotationSteps) always
          // counts as "moved enough" — the 100u damping exists to absorb pixel-
          // level cursor jitter between REAL pointermoves, not to suppress a
          // recompute the user explicitly triggered via a key press. The
          // candidate search below re-running against an unchanged hit point
          // is still hysteresis-protected (currentObj wins ties), so this
          // can't cause the anchor to flap just because a key was pressed.
          const movedEnough =
            force ||
            !lastEvalPoint ||
            Math.hypot(approxHitUE.x - lastEvalPoint.x, approxHitUE.y - lastEvalPoint.y) > REEVAL_DAMP_DIST;

          if (!movedEnough && currentObj) {
            // Damped: cursor barely moved since the anchor was last decided —
            // keep it without even looking at candidates.
            nearest = currentObj;
          } else {
            lastEvalPoint = { x: approxHitUE.x, y: approxHitUE.y };
            let best: PlacedObject | null = null;
            let bestEff = Infinity;
            for (const o of structures) {
              const d = Math.hypot(o.position.x - approxHitUE.x, o.position.y - approxHitUE.y);
              if (d > SNAP_SEARCH_RADIUS) continue;
              const eff = effectiveDist(o, d);
              if (eff < bestEff) {
                bestEff = eff;
                best = o;
              }
            }
            if (currentObj) {
              const currentHorizDist = Math.hypot(
                currentObj.position.x - approxHitUE.x,
                currentObj.position.y - approxHitUE.y,
              );
              const currentInRange = currentHorizDist <= SNAP_SEARCH_RADIUS;
              const currentEff = effectiveDist(currentObj, currentHorizDist);
              // Keep current unless it's fallen out of range, or a candidate
              // decisively beats it (below the hysteresis ratio).
              nearest = currentInRange && (!best || bestEff >= HYSTERESIS_SWITCH_RATIO * currentEff) ? currentObj : best;
            } else {
              nearest = best;
            }
          }
          currentAnchorId = nearest ? nearest.id : null;
        }

        anchorUE = nearest ? nearest.position : palboxAnchorUE;
        rotation = nearest ? nearest.rotation : palboxRotation;
        const res = targetZFor(anchorUE.z, nearest ? nearest.typeId : null);
        capActive = res.capActive;
        targetZ = res.targetZ;
        hitUE = approxHitUE;
      }

      if (!hitUE) {
        // Unreachable in practice (the object-hit branch always sets it, and
        // the fallback branch already returned early above if ITS raycast
        // missed) — guarded anyway so TypeScript can narrow `hitUE: Vec3 |
        // null` down to `Vec3` for every use below, no non-null assertions.
        usePlaceModeStore.getState().setHover(null);
        return;
      }

      const yaw = yawFromQuat(rotation);
      lastAnchorZRef.current = targetZ;

      // PALBOX-ANCHORED LATTICE ORIGIN (roof-straddles-wall bug fix): a
      // wall/pillar's own position sits at an ODD multiple of 200 off the
      // structural grid's tile centres (docs/CALIBRATION.md "Wall
      // placement"), so snapping a center-lattice piece (a roof capping a
      // wall) relative to the WALL's own position inherits that half-tile
      // parity error — the roof lands centred ON the wall's line, split
      // between both sides, a position that doesn't exist in-game. Fix:
      // whenever the active anchor's yaw is the same 90°-stepped family as
      // the palbox's (isGridAlignedYaw — cheap proxy for "this anchor is on
      // the SAME grid as the palbox," see that function's own comment for
      // why yaw, not position, is the gate — and for the numeric-verification
      // finding that yaw-alignment does NOT by itself guarantee the palbox
      // sits exactly on a disconnected cluster's own lattice, which is why
      // this stays a heuristic gate rather than a hard guarantee), re-anchor
      // ALL lattice snapping (center/edge/corner alike) — BOTH origin AND
      // frame axes — to the PALBOX's own position/rotation instead of the
      // anchor's own. In the common case (a base built outward from its own
      // palbox, one connected grid) the palbox sits at an even-parity point
      // of that same grid, which is what actually fixes the parity bug. The
      // anchor still supplies z/cap/context (targetZ, capActive, nearest —
      // all already resolved above) and its own rotation for the PLACED
      // piece's final orientation (finalRotation below still rotates
      // `rotation`, the anchor's own quaternion, never the palbox's) — only
      // the lattice math (rf/rr projection + reconstruction) uses the
      // palbox's frame. When NOT aligned (a freely-rotated furniture
      // network, or a second, disconnected structural grid at a genuinely
      // different yaw — docs/CALIBRATION.md: "one base can contain multiple
      // independent grids") this is a no-op: latticeOriginUE === anchorUE
      // and latticeYaw === yaw, identical to pre-fix behavior.
      const palboxYaw = yawFromQuat(palboxRotation);
      const gridAlignedToPalbox = !!palbox && isGridAlignedYaw(yaw, palboxYaw);
      const latticeOriginUE: Vec3 = gridAlignedToPalbox ? palboxAnchorUE : anchorUE;
      const latticeYaw = gridAlignedToPalbox ? palboxYaw : yaw;

      // Pass 2 (shared by both paths above): if the ghost's actual target z
      // (object-hit face rule, or cap + level offset in the fallback path)
      // sits on a different plane than the raycast hit we already have,
      // redo the raycast against THAT plane so the cursor tracks correctly
      // at the floor the ghost will actually render on (e.g. hovering near
      // the TOP of a wall, whose target level is one floor above the actual
      // intersection point on the wall's own top face).
      if (Math.abs(targetZ - hitUE.z) > TARGET_Z_EPSILON) {
        const reHit = raycastAtZ(targetZ);
        if (reHit) hitUE = reHit;
      }

      // Cursor hint (task "1.": "Show the active anchor in the cursor hint").
      // Locked (Tab, anchor-stability fix) takes priority over everything
      // else — "locked: <name>" is a deliberate promise that nothing below
      // (not even Alt) will move the frame off this object. Otherwise Alt
      // overrides the label to "free" even though z above still tracks the
      // active anchor — see the free-placement comment below for why.
      // "cap: <wall name>" shown whenever the smart-cap default above is
      // active; ghost-rotation suffix (R key) shown whenever a non-zero
      // rotation is dialed in, regardless of lattice — for EDGE pieces this
      // only affects corner-ambiguity tie-breaking (see snapLattice.ts), but
      // showing the raw dialed value is still useful feedback; level-offset
      // suffix shown whenever PageUp/PageDown has been used this armed
      // session.
      const baseLabel = lockedObj
        ? `locked: ${getTypeEntry(lockedObj.typeId)?.name ?? lockedObj.typeId}`
        : e.altKey
          ? "free"
          : nearest
            ? `snap: ${getTypeEntry(nearest.typeId)?.name ?? nearest.typeId}`
            : palbox
              ? "snap: palbox grid"
              : "snap: world grid";
      // Level readout (task "3."): the ghost's target Z expressed as a whole
      // floor count relative to the palbox (or world origin — WORLD_ANCHOR —
      // when there's no palbox, same fallback as everywhere else in this
      // file), so "which floor am I building on" is always legible without
      // doing the arithmetic in your head. Rounded, not floored/ceiled: every
      // targetZ that reaches this point is already an exact multiple of
      // VERTICAL_PITCH off the palbox (cap rule and level offset both move
      // in whole VERTICAL_PITCH steps), so rounding only ever cleans up
      // float noise, never masks a real half-level.
      const level = Math.round((targetZ - palboxAnchorUE.z) / VERTICAL_PITCH);
      const labelParts = [baseLabel, `L${level}`];
      if (capActive) labelParts.push(`cap: ${getTypeEntry(nearest!.typeId)?.name ?? nearest!.typeId}`);
      if (ghostRotationSteps !== 0) labelParts.push(`R: ${ghostRotationSteps * 90}°`);
      const { levelOffset } = usePlaceModeStore.getState();
      if (levelOffset !== 0) labelParts.push(`${levelOffset > 0 ? "+" : ""}${levelOffset} level${Math.abs(levelOffset) === 1 ? "" : "s"}`);
      const anchorLabel = labelParts.join(" · ");

      let x = hitUE.x;
      let y = hitUE.y;
      // Manual ghost rotation (R key) is the default/fallback rotation:
      // applies as-is for CENTER/CORNER lattice pieces and whenever Alt
      // (free placement) bypasses grid snap entirely, since there's no
      // lattice-implied orientation to derive in that case. EDGE pieces
      // overwrite this below with their snap-derived orientation whenever
      // grid snap is active.
      let finalRotation: Quat = rotateQuatByDeg(rotation, ghostRotationSteps * 90);
      if (!e.altKey) {
        // Snap to the active anchor's own grid (task brief): project the hit
        // point onto its local forward/right axes, then snap per the armed
        // type's lattice (center/edge/corner — see snapLattice.ts), reproject.
        // Same rotated-frame technique as ArrowKey nudging in
        // useKeyboardControls.ts, just anchored at the active anchor instead
        // of at the moving object's own prior position — EXCEPT both the
        // origin (latticeOriginUE) and the frame (latticeYaw) come from the
        // palbox instead of the anchor whenever gridAlignedToPalbox — see
        // that const's comment above.
        const { forward, right } = localAxesFromYaw(latticeYaw);
        const relX = hitUE.x - latticeOriginUE.x;
        const relY = hitUE.y - latticeOriginUE.y;
        const rfRaw = relX * forward.x + relY * forward.y;
        const rrRaw = relX * right.x + relY * right.y;

        let rf: number;
        let rr: number;
        if (lattice === "edge") {
          // R (ghostRotationSteps odd/even) only matters here as the
          // corner-ambiguity tiebreak (snapEdgeLattice's preferForwardOffset)
          // — the edge-implied orientation wins whenever the hit point isn't
          // exactly equidistant between two edges.
          const preferForwardOffset = ghostRotationSteps % 2 === 0;
          const snap = snapEdgeLattice(rfRaw, rrRaw, preferForwardOffset);
          rf = snap.rf;
          rr = snap.rr;
          finalRotation = rotateQuatByDeg(rotation, edgeYawOffsetDeg(snap.axis, snap.sign));
        } else if (lattice === "corner") {
          const snap = snapCornerLattice(rfRaw, rrRaw);
          rf = snap.rf;
          rr = snap.rr;
          // finalRotation already set above: manual R rotation, per task brief.
        } else {
          const snap = snapCenterLattice(rfRaw, rrRaw);
          rf = snap.rf;
          rr = snap.rr;
          // finalRotation already set above: manual R rotation, per task brief.
        }
        x = latticeOriginUE.x + forward.x * rf + right.x * rr;
        y = latticeOriginUE.y + forward.y * rf + right.y * rr;
      }
      // Alt (free placement): x/y are the raw hit point, unsnapped. z is
      // still taken from the active anchor (nearest in-range structure, or
      // the palbox) rather than always the palbox — DECISION: this keeps the
      // ghost glued to whichever floor you're hovering near even with Alt
      // held, instead of jumping back to the palbox's floor, which reads as
      // a bug ("why did my free-placed piece end up on the wrong level")
      // more than a feature. Documented per task brief ("pick and document").
      // z itself is targetZ (anchor z, plus the wall-cap default, plus the
      // armed-mode level offset — see above) for both snapped and free (Alt)
      // placement alike, purely so the offset composes with every other
      // interaction (R rotation, Alt, edge/corner lattices) without special-
      // casing any of them.

      const targetPos: Vec3 = { x, y, z: targetZ };

      // Array-stamp preview (task "B. Array stamping"): only while
      // Shift/Ctrl+Shift is held and a prior stamp exists this session to
      // fill from — see arrayStamp.ts for the line/rect math, shared with
      // the actual placement click in Scene.tsx / ObjectBox.tsx. Uses
      // finalRotation's yaw (not the raw anchor `yaw`) so the preview matches
      // what Scene.tsx/ObjectBox.tsx actually stamp — they derive their fill
      // axes from `yawFromQuat(hover.rotation)`, and for EDGE pieces
      // finalRotation differs from the anchor's own rotation by a 90°
      // multiple (still grid-aligned — see snapLattice.ts — but must be the
      // SAME yaw on both sides or preview and click could disagree).
      const { lastStampPos } = usePlaceModeStore.getState();
      const stampMode = stampModeFromModifiers(e.shiftKey, e.ctrlKey);
      const fillYaw = yawFromQuat(finalRotation);
      let fillPositions: Vec3[] | undefined;
      let fillCountFull: number | undefined;
      if (stampMode !== "single" && lastStampPos) {
        fillPositions = computeStampFill(lastStampPos, targetPos, fillYaw, stampMode);
        fillCountFull = stampFillNewCount(lastStampPos, targetPos, fillYaw, stampMode);
      }

      usePlaceModeStore.getState().setHover({
        position: targetPos,
        rotation: finalRotation,
        anchorLabel,
        anchorId: nearest?.id,
        fillPositions,
        fillCountFull,
      });
    }

    // computeHoverRef is how the forced-recompute effect (declared after
    // this one, below) reaches this specific effect run's computeHover
    // closure — see that effect and the ref's own declaration for why.
    computeHoverRef.current = computeHover;

    // Perf (task brief's "4."): a raw pointermove stream can fire faster
    // than the render loop (high-polling-rate mice, trackpads) — computing a
    // full object-raycast + snap on every single one is wasted work once
    // more than one has arrived within the same animation frame, since only
    // the LAST one before the next paint is ever visible. Coalesce with
    // rAF: the first pointermove in a frame schedules the actual
    // computeHover call, any further ones just update which event will be
    // replayed when that callback runs — at most one computeHover per frame.
    let rafId: number | null = null;
    let pendingEvent: PointerEvent | null = null;

    function onPointerMove(e: PointerEvent) {
      lastPointerEventRef.current = e;
      pendingEvent = e;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingEvent) computeHover(pendingEvent, false);
        });
      }
    }

    function onPointerLeave() {
      usePlaceModeStore.getState().setHover(null);
    }

    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerleave", onPointerLeave);
    return () => {
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerleave", onPointerLeave);
      if (rafId !== null) cancelAnimationFrame(rafId);
      usePlaceModeStore.getState().setHover(null);
      computeHoverRef.current = null;
    };
    // objects/centroidThree deliberately excluded: the listener reads them
    // via the refs above (kept fresh every render), not this closure, so the
    // listener doesn't need to be torn down and reattached on every object
    // edit — only when arming flips or the render target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedType, camera, gl]);

  // Stale-ghost fix: forces a hover recompute (replaying the last real
  // pointer event, see computeHover's `force` param above) whenever the
  // player changes something that affects the ghost WITHOUT moving the
  // mouse — R (ghostRotationSteps), PageUp/PageDown while armed
  // (levelOffset), Tab (lockedAnchorId), or re-arming a different type.
  // Declared AFTER the effect above so that on an armedType change React
  // finishes rebuilding computeHoverRef with the NEW armed session's
  // closure (fresh anchor-selection state, etc.) before this one fires —
  // effects run in declaration order within a component.
  useEffect(() => {
    if (!armedType) return;
    const lastEvent = lastPointerEventRef.current;
    if (!lastEvent) return; // nothing to replay yet — no pointermove this armed session
    computeHoverRef.current?.(lastEvent, true);
  }, [armedType, ghostRotationSteps, levelOffset, lockedAnchorId]);

  if (!armedType || !hover) return null;

  // Ghost shape: same geometry (proxyGeometry.ts, shared with ObjectBox.tsx
  // — the brief requires the ghost preview to use the identical geometry,
  // not a lookalike) and same vertical-origin convention, just translucent
  // and non-interactive (raycast disabled — RadiusRing.tsx uses the same
  // trick — so it never steals the click meant to place/select at this same
  // screen position). No zOffset needed: proxyGeometry.ts's shapes are
  // already anchored per originAtTop, so each mesh sits directly at its
  // position.z. Geometry/quaternion are identical for every ghost in a fill
  // (same armed type, same anchor rotation), so they're built once and
  // reused across every rendered ghost — cheap even at the 200-piece cap.
  const resolved = resolveType(armedType);
  const quaternion = ueQuatToThree(hover.rotation);
  const geometry = getProxyGeometry(armedType, resolved.size, resolved.originAtTop, resolved.isUnknownDims);

  // Array-stamp preview (task "B. Array stamping"): when a Shift/Ctrl+Shift
  // fill is in progress, hover.fillPositions is the authoritative list of
  // NEW cells a click would stamp (may be empty — hovering exactly back on
  // the anchor cell means "nothing new to place here"). Otherwise fall back
  // to the single cursor ghost, same as before array stamping existed.
  const ghostPositions: Vec3[] = hover.fillPositions ?? [hover.position];
  const showBadge = hover.fillPositions !== undefined && hover.fillPositions.length > 0;

  // Level reference ring (task "3."): a small flat ring around the PRIMARY
  // ghost position (not every fill-preview copy — a big line/rect fill would
  // turn a subtle height cue into visual clutter) at the ghost's own height,
  // so the eye can track which floor it's on at a glance without reading
  // the text hint. Deliberately small (~3 tiles, LEVEL_RING_RADIUS_M) rather
  // than a full-scene plane — CLAUDE.md §5 forbids rendering "ground"; this
  // is a local height cue exactly like RadiusRing.tsx's build-radius ring
  // (also non-diegetic, also raycast-disabled), not terrain.
  const ringCenter = ueVecToThree(hover.position).sub(centroidThree);
  ringCenter.y -= 0.01; // hair below the ghost's own base — avoids z-fighting, same trick as RadiusRing.tsx

  return (
    <>
      {ghostPositions.map((posUE, i) => (
        <mesh
          key={i}
          position={ueVecToThree(posUE).sub(centroidThree)}
          quaternion={quaternion}
          geometry={geometry}
          raycast={() => null}
        >
          <meshStandardMaterial
            color={resolved.color}
            transparent
            opacity={resolved.materialOpacity ?? 0.4}
            depthWrite={false}
            side={THREE.DoubleSide}
            flatShading
          />
          <Outlines thickness={1.5} color="#5be3ff" />
        </mesh>
      ))}
      {/* Level reference ring — see ringCenter's comment above. Lies flat
          (rotated off its default XY-facing normal, same as
          RadiusRing.tsx); raycast disabled so it never steals the
          placement click. */}
      <group position={ringCenter} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh raycast={() => null}>
          <ringGeometry args={[LEVEL_RING_RADIUS_M * 0.96, LEVEL_RING_RADIUS_M, 48]} />
          <meshBasicMaterial color="#5be3ff" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Active-anchor hint (task "1.": always visible while placing, so the
          user always knows which grid a click will snap to). Sits just above
          the ghost; the fill-count badge (below) sits above THIS when both
          are showing, so they never overlap. */}
      <Html
        position={ueVecToThree(hover.position).sub(centroidThree)}
        center
        pointerEvents="none"
        style={{ transform: "translateY(-28px)" }}
      >
        <div className="place-anchor-hint">{hover.anchorLabel}</div>
      </Html>
      {showBadge && (
        <Html
          position={ueVecToThree(hover.position).sub(centroidThree)}
          center
          pointerEvents="none"
          style={{ transform: "translateY(-46px)" }}
        >
          <div className="place-fill-badge">
            {hover.fillPositions!.length}
            {hover.fillCountFull !== undefined && hover.fillCountFull > hover.fillPositions!.length
              ? ` of ${hover.fillCountFull} (capped)`
              : ""}
          </div>
        </Html>
      )}
      {/* Overlap-prevention feedback (Fix 2: "already placed here" on a
          blocked single stamp, or "placed N, skipped M overlapping" after a
          fill/stack batch — placeModeStore.ts's setFeedback). Sits above the
          anchor hint / fill badge so it never overlaps either. Transient —
          auto-clears itself (setFeedback's timer), no dismiss needed. */}
      {feedback && (
        <Html
          position={ueVecToThree(hover.position).sub(centroidThree)}
          center
          pointerEvents="none"
          style={{ transform: "translateY(-64px)" }}
        >
          <div className="place-blocked-hint">{feedback}</div>
        </Html>
      )}
    </>
  );
}
