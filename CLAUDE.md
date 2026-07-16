# MapPal — Palworld Base Blueprint Editor

A browser-based spatial editor for Palworld base layouts. Load a base blueprint exported
from PalworldSaveTools, edit it in 3D, export it back. Build mega-bases out of game.

**This tool never touches a `.sav` file.** Save I/O is delegated entirely to
PalworldSaveTools (PST). We are a lens on its blueprint JSON, nothing more.

---

## 1. Why this exists

The Palworld save-editing ecosystem is mature but entirely *tabular*. Existing tools
(PalworldSaveTools, palworld-save-pal, Palworld-Pal-Editor) present bases as lists of
objects and map dots. None of them let you place a foundation in space.

The gap: there is no TerraMap for Palworld. That's what this is.

Prior art we depend on, not compete with:
- `deafdudecomputers/PalworldSaveTools` — has Export Base → `.json`, Import Base,
  Clone Base (offset), Adjust Radius. **This is our file format.**
- `cheahjs/palworld-save-tools` — the underlying GVAS parser. Reference for structure
  semantics only; we do not call it.

---

## 2. Hard constraints

These are not negotiable. Violating any of them changes the project into a different,
much worse project.

| # | Constraint | Why |
|---|---|---|
| C1 | No `.sav` parsing, reading, or writing. Ever. | The save format changes with game updates and has broken tooling before (a v0.3.7 restructure is widely reported, though we haven't verified that specific claim). PST absorbs that maintenance burden; we don't. |
| C2 | No game assets in the repo. No meshes, textures, icons ripped from `.pak`. | Legal. Distribution of Pocketpair assets is not ours to do. Gray-box proxies only. |
| C3 | Client-side only. No backend, no upload. | Blueprints are user data. Also makes it free to host. |
| C4 | Never invent a schema field. | See §4. Every field name comes from a real export or it doesn't exist. |
| C5 | Round-trip fidelity is the top priority, above features. | An export that corrupts someone's base is worse than no tool. Load → export with zero edits must produce a semantically identical file. |

---

## 3. Phase 0 — CALIBRATION (do this first, do not skip)

**Nothing else in this spec can be built correctly until this is done.** Everything
downstream depends on ground-truth numbers we do not currently have. Do not guess them.
Do not pull them from a blog post. Derive them.

The human (Alex) will run the in-game steps. Your job is to write the diffing tools and
record the findings in `docs/CALIBRATION.md`.

### 0.1 Get a reference export

1. Alex builds a deliberate calibration base in-game:
   - A Palbox.
   - A straight run of 5 wooden foundations along one axis, flush-snapped.
   - One more foundation snapped perpendicular, forming an L.
   - One foundation stacked directly on top of another.
   - 3 walls on one foundation edge: one at each of 3 rotations.
   - One chest, one workstation (e.g. Primitive Workbench), one Pal bed.
2. Alex exports it via PST → Bases tab → right-click → Export Base → `calibration_01.json`.
3. Commit it to `fixtures/calibration_01.json`.
4. **Record provenance.** PST's export format is undocumented and PST releases often
   (185 releases and counting) — the format could drift between versions. In
   `docs/CALIBRATION.md`, record the exact PST version and Palworld game version the
   fixture came from, and repeat both in a `fixtures/README.md` line per fixture.
   The loader should sanity-check incoming files for the top-level shape derived here
   and fail loudly (not guess) if a future PST version emits something different.

### 0.2 Derive, and write down

Write `tools/inspect.ts` — a CLI that dumps a blueprint's object list flat: id, type
string, position, rotation, and any linkage fields. Then answer, in `docs/CALIBRATION.md`:

- **Schema.** What is the top-level shape of the file? What is the per-object shape?
  Record actual field names verbatim. `docs/PST-EXPORT-HINTS.md` documents what PST's
  *source code* emits (top-level keys `base_camp` / `map_objects` / `item_containers`
  / `works` / …, snake_case `RawData` fields like `instance_id`,
  `base_camp_id_belong_to`, quaternion transforms under `transform.translation` etc.).
  **Treat those names as hints to look for, not facts.** Confirm every one against the
  file — the on-disk GVAS property nesting (`.value` / `.type` wrappers) in particular
  has not been observed yet.
- **Units and axes.** Unreal is centimetres, Z-up, left-handed. Confirm this holds.
- **Grid pitch.** From the 5-foundation run: what is the exact delta between adjacent
  foundation centres? That number is the snap grid. Foundations are widely said to be
  2m — confirm or refute in units.
- **Vertical pitch.** From the stacked pair: what is the Z delta per floor?
- **Rotation encoding.** Quaternion or Euler? What do the 3 wall rotations produce?
  Derive the discrete rotation steps (likely 90°, possibly finer).
- **Wall offset.** Is a wall's origin at the foundation edge, or offset? By how much?
- **Object type vocabulary.** What is the string ID for each placed piece? Start a
  registry: `src/data/objects.json`.
- **Linkage.** This is the highest-risk unknown. Do objects reference each other —
  connector IDs, parent/child, socket bindings? Does the chest carry or reference a
  container ID? Does the workstation reference a work ID? **Map this carefully.**
  It determines whether Phase 2 is a week or a month.

### 0.3 Prove the round-trip

Write `tools/roundtrip.test.ts`. Load `calibration_01.json`, parse to internal model,
serialize back, deep-diff against the original. **Zero semantic differences.** Key
ordering and float formatting may differ; nothing else may.

Then Alex re-imports the round-tripped file into a throwaway save and confirms in-game
that the base is intact. **This gate must pass before Phase 1 starts.**

---

## 4. The schema rule

You do not know this format. Neither does the person who wrote this brief.

If you find yourself writing a field name you have not personally seen in
`fixtures/calibration_01.json`, stop and say so. A plausible-looking wrong field name is
the single most likely way this project quietly produces corrupted bases. Prefer
`// UNKNOWN — needs calibration` over a confident guess.

Where a field's meaning is opaque, **preserve it verbatim and never touch it.** The
internal model should be a thin editable layer over a passthrough blob:

```ts
interface PlacedObject {
  // Fields we understand and edit
  typeId: string;
  position: Vec3;
  rotation: Quat;
  // Everything else, untouched, re-emitted as-is
  _raw: Record<string, unknown>;
}
```

---

## 5. Phase 1 — MVP: transform existing objects

Scope: **you may move, rotate, delete, and duplicate objects that already exist in the
loaded blueprint. You may not create objects from nothing.** This sidesteps the entire
GUID-synthesis and linkage-graph problem, because every object we emit came from a real
export and PST's importer already knows how to remap it.

This is the whole trick. It is what makes this shippable in a weekend instead of a month.

### Features

- **Load.** Drag-drop a PST base export. Parse, validate, report object count by type.
- **Render.** Three.js scene, orbit camera, top-down default. Every object is a
  gray-box proxy: a labelled box sized from a per-type dimension table in
  `src/data/objects.json`. Colour-coded by category (structure / production / storage /
  decor / defense). Unknown types render as a magenta box and are listed in a warning
  panel — magenta means "we don't have dimensions, but the object is preserved".
- **Select.** Click, shift-click, box-select. Selection outline.
- **Transform.** Move on the derived snap grid. Rotate in derived discrete steps.
  Arrow keys nudge by one grid unit. Escape deselects.
- **Duplicate.** Copy selection, offset by grid. New objects get fresh IDs —
  matching whatever ID convention Phase 0 revealed.
- **Delete.** With undo.
- **Undo/redo.** Full command stack. `Cmd/Ctrl+Z`. Non-negotiable in an editor.
- **Export.** Emit PST-compatible JSON. Filename `<original>_edited.json`.
- **Guardrails panel.** Live count of objects vs. the base build limit. Live check that
  everything is inside the base camp radius. Warn loudly, don't block.

### Explicitly NOT in Phase 1

- Terrain. There is no heightmap. Do not render ground. Do not attempt to snap to
  ground. The user's existing foundations *are* the ground truth for elevation — this
  is why we only transform existing objects.
- Placing new object types.
- Anything resembling a 1:1 visual match with the game.

---

## 6. Phase 2 — Place new objects (gated)

Only start after Phase 1 has round-tripped through a real save at least ten times
without incident. "Round-tripped" means the full loop: edit → export → PST import into
a real save → load the game → verify in-game. The JSON diff test alone does not count —
PST's importer remaps IDs on import, so "file that diffs clean" and "file PST imports
correctly" are different claims, and only the in-game loop tests the second one.

> **Gate decision 2026-07-16:** Alex waived the ten-round-trip count after the first
> cross-world verification, because the placement machinery is the same clone-bundle
> path as Duplicate — which the in-game evidence specifically validated (the duplicate
> was the only imported building object the game accepted during the same-world-import
> incident; see docs/CALIBRATION.md). Placement ships covered by
> `src/model/placement.test.ts`; each new donor type still needs one in-game
> verification before it's considered trusted.
>
> **2026-07-16, later:** mixed-type placement export (structures, storage,
> production machines, utility pieces) imported into a throwaway world — all
> pieces spawned correctly (verified by Alex). All 242 donor types harvested
> to date are trusted. The per-new-donor rule continues for future harvests.

The blocker is §0.2's linkage question. To synthesize a *new* chest, we likely must also
synthesize its container entry, its ID, and its registration with the base camp — and
those may live in parts of the save the blueprint export doesn't even carry.

**Strategy: the donor pattern.** Rather than construct an object from first principles,
keep a library of donor objects harvested from calibration exports. Placing a "wooden
foundation" clones a known-good donor, assigns fresh IDs, sets the transform. Objects
we have no donor for cannot be placed, and the palette says so honestly.

This means the palette grows by Alex building things in-game and exporting them. That's
fine. It's slow and it's correct.

---

## 7. Phase 3 — Nice to have

- Blueprint library: save/load layouts to IndexedDB, share via URL-encoded JSON.
- Material cost readout (buildable costs are published community data — cite source).
- Pal work-suitability overlay: which workstations are reachable/clustered.
- Symmetry/mirror tools. Array/repeat along an axis.
- Import two blueprints, merge with offset.

---

## 8. Stack

- Vite + TypeScript, strict mode.
- React + zustand for state. Editor state is a command stack, not a soup of `useState`.
- three.js. `@react-three/fiber` + `drei` for camera controls and helpers.
- Vitest for the round-trip and geometry tests.
- Zero backend. Deploy static to Vercel.

Alex has Unity background — three.js concepts map cleanly, but don't assume web-3D
idioms are familiar. Comment the scene graph setup.

---

## 9. Repo layout

```
/fixtures          calibration exports, committed, treated as test data
/docs
  CALIBRATION.md   the derived ground truth — the most important file here
  SCHEMA.md        annotated real schema, with UNKNOWN markers preserved
/src
  /parse           blueprint load/serialize + round-trip guarantee
  /model           internal editable model, command stack, undo
  /scene           three.js rendering, proxies, gizmos
  /ui              panels, palette, warnings
  /data
    objects.json   type registry: id → display name, category, dimensions
/tools
  inspect.ts       CLI blueprint dumper
```

---

## 10. Definition of done for v0.1

1. Load a real base export from a real save.
2. Move a wall three grid units.
3. Export.
4. Import via PST into a real save.
5. Load the game. The wall is three units over. Nothing else changed. Nothing is broken.

That's the whole product. Everything else is decoration on top of that loop working.

---

## 11. Working agreements

- **Fidelity over features.** If a feature risks the round-trip, cut the feature.
- **Every destructive path gets a test.** Especially delete and duplicate.
- **The tool warns; the user decides.** Over the build limit? Say so, let them export
  anyway. They asked for a mega-base.
- **Say "I don't know."** Especially about the schema. See §4.
- The README must open by telling users to back up their save, and must credit
  PalworldSaveTools and palworld-save-tools by name and link.
