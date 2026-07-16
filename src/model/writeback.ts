// Export-time reconciliation: applies the editor's PlacedObject state back
// onto a deep clone of the raw blueprint blob. This is the ONLY file that
// mutates blueprint data, and it only ever writes:
//   - transform values (move/rotate) into initital_transform_cache
//   - array membership: removing deleted objects (plus their works /
//     item_containers, per the linkage map in docs/CALIBRATION.md) and
//     appending duplicated objects with fresh GUIDs
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

export interface ReconcileResult {
  raw: unknown;
  /** Non-fatal notes for the UI/export report. */
  notes: string[];
}

/**
 * Produce a new raw blob reflecting the editor state.
 * @param raw      the untouched blob from load time
 * @param objects  current editor objects (originals — possibly moved/rotated —
 *                 and duplicates; originals absent from this list are deletions)
 */
export function reconcileExport(raw: unknown, objects: PlacedObject[]): ReconcileResult {
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
  for (const o of objects) {
    if (o.origin === "original") keptOriginals.set(o.id, o);
    else duplicates.push(o);
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
    // Works owned by a deleted object go with it (every object owns >=1 work).
    const beforeWorks = works.length;
    out.works = works.filter((w) => {
      const owner = w?.RawData?.value?.owner_map_object_model_id;
      const ownerConcrete = w?.RawData?.value?.owner_map_object_concrete_model_id;
      return !(deletedIds.has(owner) || deletedConcreteIds.has(ownerConcrete));
    });
    // Containers referenced only by deleted objects go too.
    out.item_containers = containers.filter((c) => {
      const key = c?.key?.ID?.value;
      return !(typeof key === "string" && deletedContainerIds.has(key));
    });
    // Strip surviving objects' connector links that point at deleted objects.
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
    if (!edit) continue; // a freshly appended duplicate, handled below
    const t = rd.initital_transform_cache ?? die(`${rd.instance_id}: initital_transform_cache missing`);
    t.translation = { x: edit.position.x, y: edit.position.y, z: edit.position.z };
    t.rotation = { x: edit.rotation.x, y: edit.rotation.y, z: edit.rotation.z, w: edit.rotation.w };
    // scale3d intentionally not editable in Phase 1 — left verbatim.
  }

  // --- 3. duplicates -------------------------------------------------------
  for (const dup of duplicates) {
    const src = dup.sourceId ? byId.get(dup.sourceId) : undefined;
    if (!src) die(`duplicate ${dup.id} has no valid sourceId (${dup.sourceId})`);
    if (deletedIds.has(dup.sourceId!)) die(`duplicate ${dup.id} sources a deleted object`);

    const clone = structuredClone(src);
    const srcRd = modelRawData(src, "duplicate source");
    const rd = modelRawData(clone, "duplicate clone");
    const crd = concreteRawData(clone, "duplicate clone");

    const newModelId = dup.id; // minted by the store at duplicate time
    const newConcreteId = mintGuid();
    rd.instance_id = newModelId;
    rd.concrete_model_instance_id = newConcreteId;
    crd.instance_id = newConcreteId;
    crd.model_instance_id = newModelId;

    // Fresh containers for every ItemContainer module, cloning contents.
    for (const mod of moduleEntries(clone)) {
      const oldCid = moduleContainerId(mod);
      if (!oldCid) continue;
      const srcContainer = out.item_containers.find((c: any) => c?.key?.ID?.value === oldCid);
      if (!srcContainer) {
        notes.push(
          `duplicate of ${dup.sourceId}: module container ${oldCid} not found in item_containers — link left as-is, PST import may drop the module`
        );
        continue;
      }
      const newCid = mintGuid();
      const containerClone = structuredClone(srcContainer);
      containerClone.key.ID.value = newCid;
      out.item_containers.push(containerClone);
      mod.value.RawData.value.target_container_id = newCid;
    }

    // Clone every work owned by the source; keep repair_work_id consistent.
    const srcRepairWorkId = rd.repair_work_id;
    for (const w of works) {
      const wv = w?.RawData?.value;
      if (wv?.owner_map_object_model_id !== dup.sourceId) continue;
      const workClone = structuredClone(w);
      const wcv = workClone.RawData.value;
      const newWorkId = mintGuid();
      const oldWorkId = wcv.id;
      wcv.id = newWorkId;
      wcv.owner_map_object_model_id = newModelId;
      if (wcv.owner_map_object_concrete_model_id === srcRd.concrete_model_instance_id) {
        wcv.owner_map_object_concrete_model_id = newConcreteId;
      }
      if (wcv.transform?.map_object_instance_id === dup.sourceId) {
        wcv.transform.map_object_instance_id = newModelId;
      }
      out.works.push(workClone);
      if (oldWorkId === srcRepairWorkId) rd.repair_work_id = newWorkId;
    }

    // A duplicate is free-standing: drop inherited attachment links rather
    // than claim a connection to the original's host object.
    const connect = clone?.Model?.value?.Connector?.value?.RawData?.value?.connect;
    if (connect && Array.isArray(connect.any_place) && connect.any_place.length > 0) {
      connect.any_place = [];
      notes.push(`duplicate ${newModelId}: cleared inherited connector links`);
    }

    const t = rd.initital_transform_cache ?? die("duplicate clone missing transform");
    t.translation = { x: dup.position.x, y: dup.position.y, z: dup.position.z };
    t.rotation = { x: dup.rotation.x, y: dup.rotation.y, z: dup.rotation.z, w: dup.rotation.w };

    out.map_objects.push(clone);
  }
  if (duplicates.length > 0) notes.push(`appended ${duplicates.length} duplicated object(s)`);

  return { raw: out, notes };
}
