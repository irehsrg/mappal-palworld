// Export-time linkage lint. Checks the reference graph documented in
// docs/CALIBRATION.md over a reconciled blob, so a broken file is caught at
// export instead of as silently missing pieces after PST import (PST skips
// objects with dangling works/container refs).
//
// Read-only: never mutates. Returns human-readable warnings; empty = clean.

/* eslint-disable @typescript-eslint/no-explicit-any */

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export function validateLinkage(raw: unknown): string[] {
  const warnings: string[] = [];
  const r = raw as any;
  const mapObjects: any[] = Array.isArray(r?.map_objects) ? r.map_objects : [];
  const works: any[] = Array.isArray(r?.works) ? r.works : [];
  const containers: any[] = Array.isArray(r?.item_containers) ? r.item_containers : [];
  const campId = r?.base_camp?.key;

  const workIds = new Set(works.map((w) => w?.RawData?.value?.id).filter(Boolean));
  const containerIds = new Set(
    containers.map((c) => c?.key?.ID?.value).filter(Boolean)
  );
  const modelIds = new Set<string>();
  const concreteIds = new Set<string>();

  for (const mo of mapObjects) {
    const rd = mo?.Model?.value?.RawData?.value;
    if (typeof rd?.instance_id === "string") {
      if (modelIds.has(rd.instance_id)) {
        warnings.push(`duplicate model instance_id ${rd.instance_id} — PST import will collapse these`);
      }
      modelIds.add(rd.instance_id);
    }
    const crd = mo?.ConcreteModel?.value?.RawData?.value;
    if (typeof crd?.instance_id === "string") concreteIds.add(crd.instance_id);
  }

  for (const mo of mapObjects) {
    const typeId = mo?.MapObjectId?.value ?? "?";
    const rd = mo?.Model?.value?.RawData?.value ?? {};
    const label = `${typeId} (${String(rd.instance_id).slice(0, 8)})`;

    // Model <-> ConcreteModel cross-refs — only "smart" objects have them.
    // Plain structural pieces carry the zero GUID and an opaque ConcreteModel
    // blob with no id fields (observed in fixtures); skip those.
    const crd = mo?.ConcreteModel?.value?.RawData?.value ?? {};
    const hasConcrete =
      typeof rd.concrete_model_instance_id === "string" &&
      rd.concrete_model_instance_id !== ZERO_GUID;
    if (hasConcrete) {
      if (rd.concrete_model_instance_id !== crd.instance_id) {
        warnings.push(`${label}: Model.concrete_model_instance_id does not match its ConcreteModel.instance_id`);
      }
      if (crd.model_instance_id !== rd.instance_id) {
        warnings.push(`${label}: ConcreteModel.model_instance_id does not point back at the object`);
      }
    } else if (typeof crd.instance_id === "string") {
      warnings.push(`${label}: has ConcreteModel ids but Model.concrete_model_instance_id is zero — inconsistent`);
    }

    // Camp membership
    if (campId && rd.base_camp_id_belong_to !== campId) {
      warnings.push(`${label}: base_camp_id_belong_to differs from base_camp.key — object may import into limbo`);
    }

    // Repair work reference (zero GUID = "no work yet", observed on fresh pieces)
    if (
      typeof rd.repair_work_id === "string" &&
      rd.repair_work_id !== ZERO_GUID &&
      !workIds.has(rd.repair_work_id)
    ) {
      warnings.push(`${label}: repair_work_id ${rd.repair_work_id.slice(0, 8)}… has no works entry — PST import may skip this object`);
    }

    // Container modules
    const modules = mo?.ConcreteModel?.value?.ModuleMap?.value ?? [];
    for (const mod of Array.isArray(modules) ? modules : []) {
      const cid = mod?.value?.RawData?.value?.target_container_id;
      if (typeof cid === "string" && cid !== ZERO_GUID && !containerIds.has(cid)) {
        warnings.push(`${label}: module container ${cid.slice(0, 8)}… missing from item_containers — PST import may skip this object`);
      }
    }

    // Connector links must point at objects in this file
    const anyPlace = mo?.Model?.value?.Connector?.value?.RawData?.value?.connect?.any_place;
    for (const link of Array.isArray(anyPlace) ? anyPlace : []) {
      const target = link?.connect_to_model_instance_id;
      if (typeof target === "string" && target !== ZERO_GUID && !modelIds.has(target)) {
        warnings.push(`${label}: connector link to ${target.slice(0, 8)}… which is not in this file`);
      }
    }
  }

  // Works must point back at objects in this file
  for (const w of works) {
    const wv = w?.RawData?.value ?? {};
    const owner = wv.owner_map_object_model_id;
    if (typeof owner === "string" && owner !== ZERO_GUID && !modelIds.has(owner)) {
      warnings.push(`orphan works entry ${String(wv.id).slice(0, 8)}… — owner object not in this file`);
    }
    if (campId && wv.base_camp_id_belong_to && wv.base_camp_id_belong_to !== campId) {
      warnings.push(`works entry ${String(wv.id).slice(0, 8)}… belongs to a different base camp — known cause of in-game structure purges`);
    }
  }

  return warnings;
}
