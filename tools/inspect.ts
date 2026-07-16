#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// tools/inspect.ts — schema-AGNOSTIC blueprint structure dumper.
//
// This is the tool CLAUDE.md §0.2 calls for: the thing we run against a real
// PST export to DERIVE the schema, not the thing that already knows it.
//
// Hard rule (CLAUDE.md C4 / §4): this file must not hardcode, reference, or
// special-case any Palworld/Unreal field name (no "WorldLocation", no
// "MapObjectId", nothing). Every structural fact it reports — top-level
// keys, candidate object-list arrays, vector/quaternion/GUID-shaped values —
// is discovered generically from the JSON's own shape. If you find yourself
// adding a string literal for a field name here, stop: that belongs in
// docs/CALIBRATION.md as a finding, not in this tool as an assumption.
//
// Usage:
//   npm run inspect -- <path-to-blueprint.json>
//   tsx tools/inspect.ts <path-to-blueprint.json>
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

// --- generic JSON value helpers --------------------------------------------

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type Kind =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object";

function kindOf(v: unknown): Kind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "boolean" || t === "number" || t === "string") return t;
  if (t === "object") return "object";
  // functions/undefined/symbol/bigint can't come out of JSON.parse.
  return "null";
}

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Short, single-line, truncated preview of a value for terminal output. */
function preview(v: unknown, maxLen = 70): string {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = "undefined";
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

// --- Part 1: top-level structure ---------------------------------------------

function summarizeValueForTopLevel(v: JsonValue): string {
  const k = kindOf(v);
  switch (k) {
    case "array": {
      const arr = v as JsonValue[];
      const elementKinds = new Set(arr.slice(0, 200).map(kindOf));
      const kindsLabel = elementKinds.size > 0 ? [...elementKinds].join(" | ") : "empty";
      return `array (length ${arr.length}, elements: ${kindsLabel})`;
    }
    case "object": {
      const obj = v as Record<string, JsonValue>;
      const keys = Object.keys(obj);
      const shown = keys.slice(0, 20).join(", ");
      const more = keys.length > 20 ? `, …(+${keys.length - 20} more)` : "";
      return `object (${keys.length} keys: ${shown}${more})`;
    }
    case "string":
      return `string ${preview(v)}`;
    default:
      return `${k} ${preview(v)}`;
  }
}

function printTopLevel(raw: JsonValue): void {
  console.log("=".repeat(78));
  console.log("TOP-LEVEL STRUCTURE");
  console.log("=".repeat(78));

  const rootKind = kindOf(raw);
  if (rootKind === "object") {
    const obj = raw as Record<string, JsonValue>;
    const keys = Object.keys(obj);
    console.log(`root: object with ${keys.length} top-level key(s)\n`);
    for (const key of keys) {
      console.log(`  ${key}: ${summarizeValueForTopLevel(obj[key])}`);
    }
  } else if (rootKind === "array") {
    console.log(`root: ${summarizeValueForTopLevel(raw)}`);
  } else {
    console.log(`root: ${rootKind} ${preview(raw)}`);
  }
  console.log();
}

// --- Part 2: candidate "object list" arrays ----------------------------------

interface ObjectArrayReport {
  path: string;
  length: number;
  sampledElements: number;
  // key -> info
  keys: Map<string, { types: Set<Kind>; presentCount: number; example: string }>;
}

const MAX_SAMPLE_ELEMENTS = 500; // cap shape-inference cost on huge arrays
const MAX_WALK_DEPTH = 16; // guard against pathological nesting

function analyzeObjectArray(path: string, arr: JsonValue[]): ObjectArrayReport | null {
  const sample = arr.slice(0, MAX_SAMPLE_ELEMENTS);
  const objectElements = sample.filter(isPlainObject);
  // "Similar-shaped objects": require most sampled elements to actually be
  // objects. An array of numbers or strings is not a candidate object list.
  if (objectElements.length === 0 || objectElements.length < sample.length * 0.5) {
    return null;
  }

  const keys = new Map<string, { types: Set<Kind>; presentCount: number; example: string }>();
  for (const el of objectElements) {
    for (const [k, v] of Object.entries(el)) {
      let entry = keys.get(k);
      if (!entry) {
        entry = { types: new Set(), presentCount: 0, example: preview(v) };
        keys.set(k, entry);
      }
      entry.types.add(kindOf(v));
      entry.presentCount += 1;
    }
  }

  return {
    path,
    length: arr.length,
    sampledElements: objectElements.length,
    keys,
  };
}

function printObjectArrayReport(r: ObjectArrayReport): void {
  console.log(`- ${r.path}`);
  console.log(
    `    length: ${r.length}${r.sampledElements < r.length ? ` (shape inferred from first ${r.sampledElements})` : ""}`,
  );
  console.log(`    union of keys across sampled elements (${r.keys.size} distinct keys):`);
  for (const [key, info] of [...r.keys.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const typesLabel = [...info.types].join(" | ");
    const presence = `${info.presentCount}/${r.sampledElements}`;
    console.log(`      ${key}: ${typesLabel}  (present ${presence})  e.g. ${info.example}`);
  }
  console.log();
}

// --- Part 3: heuristic vector / quaternion / GUID detection -----------------
//
// These are GUESSES based on shape alone (key names + numeric-ness, or
// string format). They are explicitly NOT confirmed field semantics. Every
// hit must be manually verified against the game/PST behavior before being
// treated as fact — see CLAUDE.md §4.

const GUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function normalizedNumericKeySet(obj: Record<string, JsonValue>): Set<string> | null {
  const entries = Object.entries(obj);
  const normalized = new Set<string>();
  for (const [k, v] of entries) {
    if (typeof v !== "number") return null;
    normalized.add(k.toLowerCase());
  }
  if (normalized.size !== entries.length) return null; // case-collision, bail
  return normalized;
}

function isVectorLike(obj: Record<string, JsonValue>): boolean {
  const norm = normalizedNumericKeySet(obj);
  if (!norm) return false;
  return norm.size === 3 && norm.has("x") && norm.has("y") && norm.has("z");
}

function isQuatLike(obj: Record<string, JsonValue>): boolean {
  const norm = normalizedNumericKeySet(obj);
  if (!norm) return false;
  return (
    norm.size === 4 && norm.has("x") && norm.has("y") && norm.has("z") && norm.has("w")
  );
}

interface HeuristicHit {
  path: string;
  example: string;
}

interface HeuristicResults {
  vectors: Map<string, HeuristicHit>; // key name -> first example
  vectorCounts: Map<string, number>;
  quats: Map<string, HeuristicHit>;
  quatCounts: Map<string, number>;
  guids: Map<string, HeuristicHit>;
  guidCounts: Map<string, number>;
}

function record(
  hits: Map<string, HeuristicHit>,
  counts: Map<string, number>,
  keyName: string,
  path: string,
  example: string,
): void {
  counts.set(keyName, (counts.get(keyName) ?? 0) + 1);
  if (!hits.has(keyName)) hits.set(keyName, { path, example });
}

function walkForHeuristics(
  value: JsonValue,
  path: string,
  parentKey: string | null,
  results: HeuristicResults,
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) return;

  if (isPlainObject(value)) {
    if (isVectorLike(value)) {
      record(results.vectors, results.vectorCounts, parentKey ?? "(unnamed)", path, preview(value));
    } else if (isQuatLike(value)) {
      record(results.quats, results.quatCounts, parentKey ?? "(unnamed)", path, preview(value));
    }
    for (const [k, v] of Object.entries(value)) {
      walkForHeuristics(v, `${path}.${k}`, k, results, depth + 1);
    }
  } else if (Array.isArray(value)) {
    const sample = value.slice(0, MAX_SAMPLE_ELEMENTS);
    sample.forEach((el, i) => {
      walkForHeuristics(el, `${path}[${i}]`, parentKey, results, depth + 1);
    });
  } else if (typeof value === "string") {
    if (GUID_RE.test(value)) {
      record(results.guids, results.guidCounts, parentKey ?? "(array element)", path, preview(value));
    }
  }
}

function printHeuristics(results: HeuristicResults): void {
  console.log("=".repeat(78));
  console.log("HEURISTIC GUESSES — verify manually before trusting any of this");
  console.log("=".repeat(78));

  console.log("\nKeys whose values look like 3D vectors (numeric x/y/z, any case):");
  if (results.vectors.size === 0) console.log("  (none found)");
  for (const [key, hit] of results.vectors) {
    console.log(
      `  "${key}"  seen ${results.vectorCounts.get(key)}x, e.g. at ${hit.path} = ${hit.example}`,
    );
  }

  console.log("\nKeys whose values look like quaternions (numeric x/y/z/w, any case):");
  if (results.quats.size === 0) console.log("  (none found)");
  for (const [key, hit] of results.quats) {
    console.log(
      `  "${key}"  seen ${results.quatCounts.get(key)}x, e.g. at ${hit.path} = ${hit.example}`,
    );
  }

  console.log("\nKeys whose string values look like GUIDs (UUID-format regex match):");
  if (results.guids.size === 0) console.log("  (none found)");
  for (const [key, hit] of results.guids) {
    console.log(
      `  "${key}"  seen ${results.guidCounts.get(key)}x, e.g. at ${hit.path} = ${hit.example}`,
    );
  }
  console.log(
    "\n(These are shape-based guesses only. A key that LOOKS like a vector might\n" +
      "not mean position, a GUID-shaped string might not be an object ID, etc.\n" +
      "Cross-check against known values — e.g. move a foundation in-game by a\n" +
      "known amount and see which vector-shaped field changes by that amount.)",
  );
  console.log();
}

// --- Part 2 driver: recursively find every candidate object-list array ------

function collectObjectArrays(
  value: JsonValue,
  path: string,
  out: ObjectArrayReport[],
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) return;

  if (Array.isArray(value)) {
    const report = analyzeObjectArray(path, value);
    if (report) out.push(report);
    // Still recurse into elements in case arrays are nested inside arrays
    // of objects (e.g. an object list whose elements each contain another
    // object list).
    value.slice(0, MAX_SAMPLE_ELEMENTS).forEach((el, i) => {
      collectObjectArrays(el, `${path}[${i}]`, out, depth + 1);
    });
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      collectObjectArrays(v, `${path}.${k}`, out, depth + 1);
    }
  }
}

// --- main --------------------------------------------------------------------

function main(): void {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("usage: tsx tools/inspect.ts <path-to-blueprint.json>");
    process.exitCode = 1;
    return;
  }

  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`could not read ${filePath}: ${msg}`);
    process.exitCode = 1;
    return;
  }

  console.log(`file: ${filePath}`);
  console.log(`size: ${(text.length / 1024).toFixed(1)} KiB\n`);

  let raw: JsonValue;
  try {
    // Plain JSON.parse handles multi-MB PST exports fine — no streaming
    // parser needed at the sizes these blueprints run.
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`not valid JSON: ${msg}`);
    process.exitCode = 1;
    return;
  }

  printTopLevel(raw);

  console.log("=".repeat(78));
  console.log("CANDIDATE OBJECT-LIST ARRAYS (arrays of similar-shaped objects)");
  console.log("=".repeat(78));
  const arrays: ObjectArrayReport[] = [];
  collectObjectArrays(raw, "$", arrays, 0);
  if (arrays.length === 0) {
    console.log("(none found)\n");
  } else {
    for (const r of arrays) printObjectArrayReport(r);
  }

  const heuristics: HeuristicResults = {
    vectors: new Map(),
    vectorCounts: new Map(),
    quats: new Map(),
    quatCounts: new Map(),
    guids: new Map(),
    guidCounts: new Map(),
  };
  walkForHeuristics(raw, "$", null, heuristics, 0);
  printHeuristics(heuristics);
}

main();
