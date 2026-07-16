// ---------------------------------------------------------------------------
// Blueprint load/serialize — passthrough with round-trip fidelity (CLAUDE.md C5).
//
// Phase 0 calibration is DONE (2026-07-16): the top-level shape and confirmed
// field names live in docs/SCHEMA.md and docs/CALIBRATION.md, derived from
// fixtures/calibration_01.json (PST v2.1.0). This module still treats the file
// body as an opaque blob — the editable model layer (CLAUDE.md §4
// PlacedObject/_raw) will read into it, but serialization must always re-emit
// everything it didn't explicitly edit, verbatim.
// ---------------------------------------------------------------------------

/** Opaque parsed JSON. Field access belongs in the model layer, not here. */
export type RawBlueprint = unknown;

export interface LoadedBlueprint {
  /** The entire parsed file, untouched. This is the only thing we trust. */
  raw: RawBlueprint;
  /** Non-fatal notes surfaced to the UI. */
  warnings: string[];
}

/**
 * Top-level keys observed in a real PST v2.1.0 export (docs/SCHEMA.md).
 * PST's own importer (`is_old_blueprint`) hard-requires only
 * `dynamic_items` and `base_camp_level`; we mirror that split: those two are
 * fatal if missing, the rest produce loud warnings.
 */
const REQUIRED_KEYS = ["dynamic_items", "base_camp_level"] as const;
const EXPECTED_KEYS = [
  "base_camp",
  "base_camp_level",
  "map_objects",
  "characters",
  "item_containers",
  "char_containers",
  "works",
  "dynamic_items",
] as const;

export function loadBlueprint(text: string): LoadedBlueprint {
  let raw: RawBlueprint;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`loadBlueprint: input is not valid JSON (${message})`);
  }

  const warnings = sanityCheckSchema(raw);
  return { raw, warnings };
}

/**
 * Re-emit a loaded blueprint's raw blob as JSON text.
 *
 * NOT plain JSON.stringify: the source files are written by Python, which
 * serializes IEEE-754 negative zero as `-0.0`. JSON.stringify(-0) emits "0",
 * silently flipping the sign bit of 16 floats in the calibration fixture
 * alone. Numerically harmless, but C5 says fidelity above all and preserving
 * it costs nothing — so we walk the tree ourselves. Key order is preserved
 * (JS objects keep insertion order, which JSON.parse sets from file order).
 */
export function serializeBlueprint(bp: LoadedBlueprint): string {
  return stringifyPreservingNegativeZero(bp.raw);
}

function stringifyPreservingNegativeZero(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number":
      // JSON.parse can only ever produce finite numbers, so no NaN/Infinity
      // handling is needed on data that came from loadBlueprint.
      return Object.is(v, -0) ? "-0.0" : JSON.stringify(v);
    case "string":
    case "boolean":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) {
        return "[" + v.map(stringifyPreservingNegativeZero).join(",") + "]";
      }
      const obj = v as Record<string, unknown>;
      const parts = Object.keys(obj).map(
        (k) => JSON.stringify(k) + ":" + stringifyPreservingNegativeZero(obj[k])
      );
      return "{" + parts.join(",") + "}";
    }
    default:
      // undefined / function / symbol cannot appear in JSON.parse output.
      throw new Error(`serializeBlueprint: unserializable value of type ${typeof v}`);
  }
}

/**
 * Sanity check against the top-level shape derived in Phase 0
 * (docs/CALIBRATION.md, docs/SCHEMA.md). Fails loudly rather than guessing
 * when a file doesn't look like a PST base export (CLAUDE.md §0.1.4).
 */
export function sanityCheckSchema(raw: RawBlueprint): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      "loadBlueprint: file is not a JSON object — not a PST base export"
    );
  }
  const keys = new Set(Object.keys(raw));

  const missingRequired = REQUIRED_KEYS.filter((k) => !keys.has(k));
  if (missingRequired.length > 0) {
    // Mirrors PST's own version check: it refuses these files too.
    throw new Error(
      `loadBlueprint: missing key(s) ${missingRequired.join(", ")} — either not a PST base export, or exported by an old PST version. Re-export with PST v2.1.0+.`
    );
  }

  const warnings: string[] = [];
  const missingExpected = EXPECTED_KEYS.filter((k) => !keys.has(k));
  if (missingExpected.length > 0) {
    warnings.push(
      `top-level key(s) missing vs. calibrated schema: ${missingExpected.join(", ")} — file loads, but this PST version's format may have drifted (see docs/SCHEMA.md)`
    );
  }
  const unexpected = [...keys].filter(
    (k) => !(EXPECTED_KEYS as readonly string[]).includes(k)
  );
  if (unexpected.length > 0) {
    warnings.push(
      `unrecognized top-level key(s): ${unexpected.join(", ")} — preserved verbatim, but the schema may have grown since calibration (2026-07-16, PST v2.1.0)`
    );
  }
  return warnings;
}
