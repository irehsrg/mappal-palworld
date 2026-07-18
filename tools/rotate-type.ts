// Rotate every object of a matching type IN PLACE (own position, yaw only)
// inside a blueprint JSON. One-off repair tool — born 2026-07-18 when the
// editor's stair proxy turned out mirrored versus the real game mesh, leaving
// exported stairs facing backwards.
//
// Usage: npx tsx tools/rotate-type.ts <in.json> <typeSubstring> <degrees> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

/* eslint-disable @typescript-eslint/no-explicit-any */
const [inPath, typeSub, degStr, outPath] = process.argv.slice(2);
if (!inPath || !typeSub || !degStr || !outPath) {
  console.error("usage: npx tsx tools/rotate-type.ts <in.json> <typeSubstring> <degrees> <out.json>");
  process.exit(1);
}
const deg = Number(degStr);
const half = (deg * Math.PI) / 360;
const qz = { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };

// Hamilton product a ⊗ b — same convention as the editor's Q/E rotation.
function mul(a: any, b: any) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

const raw: any = JSON.parse(readFileSync(inPath, "utf8"));
const sub = typeSub.toLowerCase();
let n = 0;
for (const mo of raw.map_objects ?? []) {
  const t = String(mo?.MapObjectId?.value ?? "");
  if (!t.toLowerCase().includes(sub)) continue;
  const tc = mo?.Model?.value?.RawData?.value?.initital_transform_cache;
  if (!tc?.rotation) continue;
  tc.rotation = mul(qz, tc.rotation);
  n++;
}
writeFileSync(outPath, JSON.stringify(raw));
console.log(`rotated ${n} object(s) matching "${typeSub}" by ${deg}° in place -> ${outPath}`);
