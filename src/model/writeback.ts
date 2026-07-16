// Export-time reconciliation: applies the editor's PlacedObject state back
// onto a deep clone of the raw blueprint blob. This is the ONLY file that
// mutates blueprint data, and it only ever writes:
//   - transform values (move/rotate) into initital_transform_cache
//   - the base camp anchor (kept equal to the palbox transform, as observed)
//   - array membership: removing deleted objects (plus their works /
//     item_containers, per the linkage map in docs/CALIBRATION.md) and
//     appending cloned bundles for duplicated ("duplicate") and palette-
//     placed ("placed") objects with fresh GUIDs
// Duplicates clone from this file; placed objects clone from donor bundles
// harvested from real exports (tools/harvest-donors.ts, CLAUDE.md §6).
// Every path written here was observed in fixtures/calibration_01.json
// (docs/SCHEMA.md). Anything unexpected throws rather than guessing.

import type { PlacedObject } from "./types";

// The blob is untyped by design (CLAUDE.md §4): we navigate it with runtime
// checks and loud failures instead of pretending we have a full static schema.
/* eslint-disable @typescript-eslint/no-explicit-any */

const die = (msg: string): never => {
  throw new Error(`writeback: ${msg} — refusing to guess (docs/SCHEMA.md)`);
};

function modelRawData(obj: any, label: string): any {
  return obj?.Model?.value?.RawData?.value ?? die(`${label}: Model.value.RawData.value missing`);
}
function concreteRawData(obj: any, label: string): any {
  return obj?.ConcreteModel?.value?.RawData?.value ?? die(`${label}: ConcreteModel.value.RawData.value missing`);
}
/** ModuleMap entries: [{key: "...ModuleType::ItemContainer", value: {RawData: {value: {target_container_id}}}}] */
function moduleEntries(obj: any): any[] {
  const m = obj?.ConcreteModel?.value?.ModuleMap?.value;
  return Array.isArray(m) ? m : [];
}
function moduleContainerId(mod: any): string | null {
  const id = mod?.value?.RawData?.value?.target_container_id;
  return typeof id === "string" ? id : null;
}

export function mintGuid(): string {
  return crypto.randomUUID();
}

/** One donor bundle as produced by tools/harvest-donors.ts. */
export interface DonorBundle {
  map_object: unknown;
  works: unknown[];
  item_containers: unknown[];
}
export type DonorLibrary = Record<string, DonorBundle>;

/** Types that must never be palette-placed. A palbox IS the base camp; a
 *  second one would require synthesizing a whole new camp — out of scope. */
const UNPLACEABLE = new Set(["PalBoxV2"]);

export interface ReconcileResult {
  raw: unknown;
  /** Non-fatal notes for the UI/export report. */
  notes: string[];
}

interface CloneOptions {
  newModelId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  /** When set (palette placement), rewrite camp/group membership to this file's. */
  rebase?: { campId: string; groupId: string };
  label: string;
}

/**
 * Clone one object bundle (map_object + its works + its containers) with
 * fresh, mutually consistent GUIDs. This is the in-game-proven path: a bundle
 * cloned this way was the only imported building object the game accepted
 * during the 2026-07-16 same-world-import incident (docs/CALIBRATION.md).
 */
function cloneBundle(
  srcMapObject: any,
  srcWorks: any[],
  srcContainers: any[],
  opts: CloneOptions,
  notes: string[]
): { mapObject: any; works: any[]; containers: any[] } {
  const clone = structuredClone(srcMapObject);
  const srcRd = modelRawData(srcMapObject, `${opts.label} source`);
  const rd = modelRawData(clone, `${opts.label} clone`);
  const crd = concreteRawData(clone, `${opts.label} clone`);

  const newConcreteId = mintGuid();
  rd.instance_id = opts.newModelId;
  rd.concrete_model_instance_id = newConcreteId;
  crd.instance_id = newConcreteId;
  crd.model_instance_id = opts.newModelId;
  if (opts.rebase) {
    rd.base_camp_id_belong_to = opts.rebase.campId;
    rd.group_id_belong_to = opts.rebase.groupId;
  }

  // Fresh containers for every ItemContainer module, cloning contents.
  const containers: any[] = [];
  for (const mod of moduleEntries(clone)) {
    const oldCid = moduleContainerId(mod);
    if (!oldCid) continue;
    const srcContainer = srcContainers.find((c: any) => c?.key?.ID?.value === oldCid);
    if (!srcContainer) {
      notes.push(
        `${opts.label}: module container ${oldCid} not found — link left as-is, PST import may drop the module`
      );
      continue;
    }
    const newCid = mintGuid();
    const containerClone = structuredClone(srcContainer);
    containerClone.key.ID.value = newCid;
    containers.push(containerClone);
    mod.value.RawData.value.target_container_id = newCid;
  }

  // Clone every work owned by the source; keep repair_work_id consistent.
  const works: any[] = [];
  const srcRepairWorkId = rd.repair_work_id;
  for (const w of srcWorks) {
    const wv = w?.RawData?.value;
    if (wv?.owner_map_object_model_id !== srcRd.instance_id) continue;
    const workClone = structuredClone(w);
    const wcv = workClone.RawData.value;
    const newWorkId = mintGuid();
    const oldWorkId = wcv.id;
    wcv.id = newWorkId;
    wcv.owner_map_object_model_id = opts.newModelId;
    if (wcv.owner_map_object_concrete_model_id === srcRd.concrete_model_instance_id) {
      wcv.owner_map_object_concrete_model_id = newConcreteId;
    }
    if (wcv.transform?.map_object_instance_id === srcRd.instance_id) {
      wcv.transform.map_object_instance_id = opts.newModelId;
    }
    if (opts.rebase) {
      wcv.base_camp_id_belong_to = opts.rebase.campId;
    }
    works.push(workClone);
    if (oldWorkId === srcRepairWorkId) rd.repair_work_id = newWorkId;
  }

  // A clone stands alone: drop inherited attachment links rather than claim
  // a connection to the source's host object. (Deletion propagates along
  // these links in-game — link-free objects survive; docs/CALIBRATION.md.)
  const connect = clone?.Model?.value?.Connector?.value?.RawData?.value?.connect;
  if (connect && Array.isArray(connect.any_place) && connect.any_place.length > 0) {
    connect.any_place = [];
  }

  const t = rd.initital_transform_cache ?? die(`${opts.label} clone missing transform`);
  t.translation = { x: opts.position.x, y: opts.position.y, z: opts.position.z };
  t.rotation = { x: opts.rotation.x, y: opts.rotation.y, z: opts.rotation.z, w: opts.rotation.w };

  return { mapObject: clone, works, containers };
}

/**
 * Produce a new raw blob reflecting the editor state.
 * @param raw      the untouched blob from load time
 * @param objects  current editor objects: originals (possibly moved/rotated),
 *                 duplicates, and palette-placed objects; originals absent
 *                 from this list are deletions
 * @param donors   donor library for origin:"placed" objects (src/data/donors.json)
 */
export function reconcileExport(
  raw: unknown,
  objects: PlacedObject[],
  donors: DonorLibrary = {}
): ReconcileResult {
  const notes: string[] = [];
  const out: any = structuredClone(raw);
  const mapObjects: any[] = Array.isArray(out?.map_objects)
    ? out.map_objects
    : die("raw.map_objects is not an array");
  const works: any[] = Array.isArray(out?.works) ? out.works : die("raw.works is not an array");
  const containers: any[] = Array.isArray(out?.item_containers)
    ? out.item_containers
    : die("raw.item_containers is not an array");

  const byId = new Map<string, any>();
  for (const mo of mapObjects) {
    const id = modelRawData(mo, "map_object").instance_id;
    if (typeof id !== "string") die("map_object without string instance_id");
    if (byId.has(id)) die(`duplicate instance_id ${id} in source file`);
    byId.set(id, mo);
  }

  const keptOriginals = new Map<string, PlacedObject>();
  const duplicates: PlacedObject[] = [];
  const placed: PlacedObject[] = [];
  for (const o of objects) {
    if (o.origin === "original") keptOriginals.set(o.id, o);
    else if (o.origin === "duplicate") duplicates.push(o);
    else placed.push(o);
  }

  // --- 1. deletions -------------------------------------------------------
  const deletedIds = new Set<string>();
  const deletedConcreteIds = new Set<string>();
  const deletedContainerIds = new Set<string>();
  for (const [id, mo] of byId) {
    if (keptOriginals.has(id)) continue;
    deletedIds.add(id);
    const crd = concreteRawData(mo, `deleted ${id}`);
    if (typeof crd.instance_id === "string") deletedConcreteIds.add(crd.instance_id);
    for (const mod of moduleEntries(mo)) {
      const cid = moduleContainerId(mod);
      if (cid) deletedContainerIds.add(cid);
    }
  }

  if (deletedIds.size > 0) {
    out.map_objects = mapObjects.filter(
      (mo) => !deletedIds.has(modelRawData(mo, "map_object").instance_id)
    );
    const beforeWorks = works.length;
    out.works = works.filter((w) => {
      const owner = w?.RawData?.value?.owner_map_object_model_id;
      const ownerConcrete = w?.RawData?.value?.owner_map_object_concrete_model_id;
      return !(deletedIds.has(owner) || deletedConcreteIds.has(ownerConcrete));
    });
    out.item_containers = containers.filter((c) => {
      const key = c?.key?.ID?.value;
      return !(typeof key === "string" && deletedContainerIds.has(key));
    });
    for (const mo of out.map_objects) {
      const connect = mo?.Model?.value?.Connector?.value?.RawData?.value?.connect;
      if (connect && Array.isArray(connect.any_place)) {
        const before = connect.any_place.length;
        connect.any_place = connect.any_place.filter(
          (l: any) => !deletedIds.has(l?.connect_to_model_instance_id)
        );
        if (connect.any_place.length !== before) {
          notes.push(
            `stripped ${before - connect.any_place.length} connector link(s) to deleted object(s) from ${modelRawData(mo, "map_object").instance_id}`
          );
        }
      }
    }
    notes.push(
      `deleted ${deletedIds.size} object(s), ${beforeWorks - out.works.length} work entry(ies), ${containers.length - out.item_containers.length} container(s)`
    );
  }

  // --- 2. transforms on kept originals ------------------------------------
  for (const mo of out.map_objects) {
    const rd = modelRawData(mo, "map_object");
    const edit = keptOriginals.get(rd.instance_id);
    if (!edit) continue;
    const t = rd.initital_transform_cache ?? die(`${rd.instance_id}: initital_transform_cache missing`);
    t.translation = { x: edit.position.x, y: edit.position.y, z: edit.position.z };
    t.rotation = { x: edit.rotation.x, y: edit.rotation.y, z: edit.rotation.z, w: edit.rotation.w };
    // scale3d intentionally not editable in Phase 1 — left verbatim.
  }

  // --- 2b. base camp anchor follows the palbox -----------------------------
  // Observed in the fixture: base_camp.RawData.transform is byte-identical to
  // the palbox's initital_transform_cache (same translation AND rotation).
  // The camp anchor is the palbox. If the (single, original) palbox was moved,
  // move the camp with it — this is what makes relocating a whole base work.
  // With zero edits this writes back identical values, preserving round-trip
  // fidelity. Anything ambiguous (no palbox, several) is left verbatim.
  {
    const palboxes = out.map_objects.filter(
      (mo: any) => mo?.MapObjectId?.value === "PalBoxV2"
    );
    if (palboxes.length === 1) {
      const pbT = modelRawData(palboxes[0], "palbox").initital_transform_cache;
      const campT = out?.base_camp?.value?.RawData?.value?.transform;
      if (pbT && campT) {
        campT.translation = { ...pbT.translation };
        campT.rotation = { ...pbT.rotation };
      } else {
        notes.push("base_camp transform or palbox transform missing — camp anchor left verbatim");
      }
    } else {
      notes.push(
        `expected exactly 1 PalBoxV2, found ${palboxes.length} — camp anchor left verbatim`
      );
    }
  }

  // --- 3. duplicates (clone from this file) --------------------------------
  for (const dup of duplicates) {
    const src = dup.sourceId ? byId.get(dup.sourceId) : undefined;
    if (!src) die(`duplicate ${dup.id} has no valid sourceId (${dup.sourceId})`);
    if (deletedIds.has(dup.sourceId!)) die(`duplicate ${dup.id} sources a deleted object`);

    const bundle = cloneBundle(src, works, out.item_containers, {
      newModelId: dup.id,
      position: dup.position,
      rotation: dup.rotation,
      label: `duplicate of ${dup.sourceId}`,
    }, notes);
    out.map_objects.push(bundle.mapObject);
    out.works.push(...bundle.works);
    out.item_containers.push(...bundle.containers);
  }
  if (duplicates.length > 0) notes.push(`appended ${duplicates.length} duplicated object(s)`);

  // --- 4. palette placements (clone from donor library) --------------------
  if (placed.length > 0) {
    const campId = out?.base_camp?.key;
    const groupId = out?.base_camp?.value?.RawData?.value?.group_id_belong_to;
    if (typeof campId !== "string" || typeof groupId !== "string") {
      die("cannot place objects: base_camp key/group_id_belong_to not found");
    }
    for (const p of placed) {
      if (UNPLACEABLE.has(p.typeId)) die(`type ${p.typeId} cannot be palette-placed`);
      const donor = donors[p.typeId];
      if (!donor) die(`no donor bundle for type ${p.typeId} — harvest one from a real export first`);

      const bundle = cloneBundle(donor.map_object, donor.works as any[], donor.item_containers as any[], {
        newModelId: p.id,
        position: p.position,
        rotation: p.rotation,
        rebase: { campId, groupId },
        label: `placed ${p.typeId}`,
      }, notes);
      out.map_objects.push(bundle.mapObject);
      out.works.push(...bundle.works);
      out.item_containers.push(...bundle.containers);
    }
    notes.push(`placed ${placed.length} new object(s) from donor library`);
  }

  return { raw: out, notes };
}
