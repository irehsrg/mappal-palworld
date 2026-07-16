// Shared editor-model contract. UI and scene code depend on these types and on
// the store API in store.ts — nothing outside src/model reads the raw blob.

/** Unreal-space vector: centimetres, Z-up. Conversion to three.js space
 *  happens in src/scene, never here. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion as stored in the blueprint (x, y, z, w). */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export type Category =
  | "structure"
  | "production"
  | "storage"
  | "decor"
  | "defense"
  | "world";

/**
 * Editable view over one map object (CLAUDE.md §4). Holds only the fields we
 * understand; everything else stays in the raw blob and is re-emitted verbatim
 * at export time by src/model/writeback.ts.
 */
export interface PlacedObject {
  /** Model.RawData.instance_id for originals; freshly minted GUID for duplicates. */
  id: string;
  /** MapObjectId.value, e.g. "Wooden_foundation". */
  typeId: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  hpCurrent?: number;
  hpMax?: number;
  /**
   * originals came from the loaded file (id exists in raw); duplicates are
   * cloned at export time from their sourceId's raw entry with fresh GUIDs;
   * placed objects are cloned from the donor library (src/data/donors.json).
   */
  origin: "original" | "duplicate" | "placed";
  /** For duplicates: the original object's id to clone from. */
  sourceId?: string;
}

/** Derived per-object grid frame: objects sharing a yaw belong to one snap grid. */
export const GRID_PITCH = 400; // units (cm) between foundation centres — docs/CALIBRATION.md
export const VERTICAL_PITCH = 325; // units per wall/pillar segment
