// Test-only helper: structural diff between two JSON-parsed values.
//
// Returns a flat list of path strings identifying every leaf (or shape
// mismatch) where `a` and `b` differ. Used by the model-layer tests to prove
// round-trip / edit-scoping guarantees (CLAUDE.md C5) without hand-rolling a
// bespoke comparison per test.
//
// IMPORTANT: -0 and 0 are treated as DIFFERENT values (Object.is semantics),
// not as ===-equal. This project's round-trip guarantee depends on
// preserving the IEEE-754 sign bit that Python's `-0.0` floats carry (see
// docs/CALIBRATION.md's round-trip gate note and src/parse/blueprint.ts's
// stringifyPreservingNegativeZero). A diff tool that used `===` would call
// a flipped sign bit "no change" and silently hide the exact bug this
// project already fixed once.

export function deepDiff(a: unknown, b: unknown, path = "$"): string[] {
  // Numbers: compare with Object.is so -0 !== 0, and NaN would equal NaN
  // (never actually produced by JSON.parse, but harmless to get right).
  if (typeof a === "number" && typeof b === "number") {
    return Object.is(a, b) ? [] : [path];
  }

  if (typeof a !== typeof b) return [path];

  if (a === null || b === null) {
    return a === b ? [] : [path];
  }

  if (typeof a !== "object") {
    // string / boolean
    return a === b ? [] : [path];
  }

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return [path];

  const diffs: string[] = [];

  if (aIsArr) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) {
      diffs.push(`${path}.length (a=${aa.length}, b=${bb.length})`);
    }
    const len = Math.max(aa.length, bb.length);
    for (let i = 0; i < len; i++) {
      if (i >= aa.length) {
        diffs.push(`${path}[${i}] (missing in a)`);
      } else if (i >= bb.length) {
        diffs.push(`${path}[${i}] (missing in b)`);
      } else {
        diffs.push(...deepDiff(aa[i], bb[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    const childPath = `${path}.${k}`;
    if (!(k in ao)) {
      diffs.push(`${childPath} (missing in a)`);
    } else if (!(k in bo)) {
      diffs.push(`${childPath} (missing in b)`);
    } else {
      diffs.push(...deepDiff(ao[k], bo[k], childPath));
    }
  }
  return diffs;
}
