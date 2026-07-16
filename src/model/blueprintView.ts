// Read-only extraction of PlacedObject views from the raw blueprint blob.
// Every path accessed here was observed in fixtures/calibration_01.json and is
// documented in docs/SCHEMA.md. Anything missing fails loudly (CLAUDE.md §4) —
// we never guess a default for a field we expected to find.

import type { PlacedObject, Quat, Vec3 } from "./types";

// Minimal structural types for the paths we read. Everything else in these
// objects is deliberately untyped and untouched.
interface RawMapObject {
  MapObjectId?: { value?: unknown };
  Model?: { value?: { RawData?: { value?: RawModelData } } };
}
interface RawModelData {
  instance_id?: unknown;
  hp?: { current?: unknown; max?: unknown };
  initital_transform_cache?: {
    // sic — the game's own typo, see docs/SCHEMA.md
    rotation?: Partial<Quat>;
    translation?: Partial<Vec3>;
    scale3d?: Partial<Vec3>;
  };
}

function fail(index: number, what: string): never {
  throw new Error(
    `blueprintView: map_objects[${index}] is missing ${what} — schema drift vs docs/SCHEMA.md (calibrated 2026-07-16, PST v2.1.0). Refusing to guess.`
  );
}

function asVec3(v: Partial<Vec3> | undefined, index: number, what: string): Vec3 {
  if (
    !v ||
    typeof v.x !== "number" ||
    typeof v.y !== "number" ||
    typeof v.z !== "number"
  )
    fail(index, what);
  return { x: v.x, y: v.y, z: v.z };
}

function asQuat(q: Partial<Quat> | undefined, index: number, what: string): Quat {
  if (
    !q ||
    typeof q.x !== "number" ||
    typeof q.y !== "number" ||
    typeof q.z !== "number" ||
    typeof q.w !== "number"
  )
    fail(index, what);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Returns raw.map_objects or throws loudly. */
export function getMapObjects(raw: unknown): unknown[] {
  const objs = (raw as { map_objects?: unknown })?.map_objects;
  if (!Array.isArray(objs)) {
    throw new Error("blueprintView: raw.map_objects is not an array");
  }
  return objs;
}

/** Extract editable views from every map object. Read-only: raw is not touched. */
export function extractObjects(raw: unknown): PlacedObject[] {
  return getMapObjects(raw).map((entry, i) => {
    const o = entry as RawMapObject;
    const typeId = o.MapObjectId?.value;
    if (typeof typeId !== "string") fail(i, "MapObjectId.value");

    const rd = o.Model?.value?.RawData?.value;
    if (!rd) fail(i, "Model.value.RawData.value");

    const id = rd.instance_id;
    if (typeof id !== "string") fail(i, "RawData.value.instance_id");

    const t = rd.initital_transform_cache;
    if (!t) fail(i, "initital_transform_cache");

    const hpCurrent = typeof rd.hp?.current === "number" ? rd.hp.current : undefined;
    const hpMax = typeof rd.hp?.max === "number" ? rd.hp.max : undefined;

    return {
      id,
      typeId,
      position: asVec3(t.translation, i, "translation"),
      rotation: asQuat(t.rotation, i, "rotation"),
      scale: asVec3(t.scale3d, i, "scale3d"),
      hpCurrent,
      hpMax,
      origin: "original" as const,
    };
  });
}
