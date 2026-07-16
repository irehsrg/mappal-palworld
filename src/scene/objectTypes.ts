// Shared lookup over src/data/objects.json — the gray-box dimension/category
// registry (CLAUDE.md §5). Used by both src/scene (to build box geometry)
// and src/ui (counts-by-category, unknown-type warnings), which is why it
// lives in its own small module instead of inside Scene.tsx.
import objectsJson from "../data/objects.json";
import type { Category, PlacedObject } from "../model/types";

export interface TypeEntry {
  name: string;
  category: Category;
  /** Full extents in cm, [length, thickness, height] — see coords.ts header. Any element null = not yet measured. */
  size: [number | null, number | null, number | null];
  sizeSource: string;
  /** Foundations only: the box extends DOWNWARD from the stored Z (origin at top surface). Everything else extends upward (origin at bottom). */
  originAtTop?: boolean;
}

const TYPES = objectsJson.types as unknown as Record<string, TypeEntry>;

export const UNKNOWN_COLOR = "#ff00ff"; // magenta — "preserved, but we don't have dimensions"

export const CATEGORY_COLOR: Record<Category, string> = {
  structure: "#8a7a5c",
  production: "#4a7fb5",
  storage: "#55a06a",
  decor: "#9a6fb0",
  defense: "#b05555",
  world: "#444444",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  structure: "Structure",
  production: "Production",
  storage: "Storage",
  decor: "Decor",
  defense: "Defense",
  world: "World (non-buildable)",
};

export function getTypeEntry(typeId: string): TypeEntry | undefined {
  return TYPES[typeId];
}

/** Resolved render info for one object: concrete size (magenta fallback if unmeasured/unknown) + color + whether it's a "we don't really know this one" case. */
export interface ResolvedType {
  size: [number, number, number];
  color: string;
  category: Category | "unknown";
  originAtTop: boolean;
  /** True when the typeId isn't registered at all, or is registered but has one or more null size components. */
  isUnknownDims: boolean;
}

export function resolveType(typeId: string): ResolvedType {
  const entry = getTypeEntry(typeId);
  const hasFullSize = !!entry && entry.size.every((n): n is number => n !== null);
  if (!entry || !hasFullSize) {
    return {
      size: [100, 100, 100],
      color: UNKNOWN_COLOR,
      category: entry?.category ?? "unknown",
      originAtTop: entry?.originAtTop === true,
      isUnknownDims: true,
    };
  }
  return {
    size: entry.size as [number, number, number],
    color: CATEGORY_COLOR[entry.category],
    category: entry.category,
    originAtTop: entry.originAtTop === true,
    isUnknownDims: false,
  };
}

/** Tally objects by category (structure/production/.../unknown) for the sidebar counts panel. */
export function countByCategory(objects: PlacedObject[]): { category: Category | "unknown"; count: number }[] {
  const counts = new Map<Category | "unknown", number>();
  for (const o of objects) {
    const cat = resolveType(o.typeId).category;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** typeIds rendered magenta (unregistered, or registered without full dimensions) with occurrence counts — for the warnings panel. */
export function unknownDimensionTypes(objects: PlacedObject[]): { typeId: string; count: number; registered: boolean }[] {
  const counts = new Map<string, number>();
  for (const o of objects) {
    if (resolveType(o.typeId).isUnknownDims) counts.set(o.typeId, (counts.get(o.typeId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([typeId, count]) => ({ typeId, count, registered: !!getTypeEntry(typeId) }))
    .sort((a, b) => b.count - a.count);
}
