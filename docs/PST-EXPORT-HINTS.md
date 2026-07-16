# PST Export Base format — source-derived hints

> **Status: HINTS, not schema facts.** Everything here was read from
> PalworldSaveTools **source code** (repo `deafdudecomputers/PalworldSaveTools`,
> around release v2.1.0, fetched 2026-07-16) — not from a real export file.
> Per CLAUDE.md §4, nothing here may be used in parse code until confirmed against
> `fixtures/calibration_01.json`. When confirmed, graduate it into `docs/SCHEMA.md`.

Source files of record (paths within the PST repo):
`src/palworld_aio/managers/base_manager.py` (export/import logic),
`src/palworld_aio/managers/backup_manager.py` (`.pstbase` wrapper),
`src/palworld_aio/ui/tabs/map_tab.py` (UI glue, writes the plain `.json`),
`src/palsav/palsav/rawdata/map_model.py`, `map_concrete_model.py`,
`src/palsav/palsav/archive.py` (`ftransform`).

## 1. Top-level shape of a plain `.json` export

`export_base_json()` builds this dict and it is dumped to disk with **no wrapper**:

```python
{
    'base_camp': ...,        # the single BaseCampSaveData entry (key+value)
    'base_camp_level': ...,  # int, from GroupSaveDataMap
    'map_objects': [],       # MapObjectSaveData entries
    'characters': [],        # CharacterSaveParameterMap entries (working Pals)
    'item_containers': [],   # ItemContainerSaveData entries (chest contents!)
    'char_containers': [],   # CharacterContainerSaveData entries (worker slots)
    'works': [],             # WorkSaveData entries
    'dynamic_items': [],     # DynamicItemSaveData entries
}
```

- Plain `.json` has **no version field**. PST's `is_old_blueprint()` uses the
  *presence of the keys* `dynamic_items` and `base_camp_level` as the implicit
  version marker; `import_base_json()` refuses files missing them. Our loader's
  sanity check should mirror this.
- The compressed `.pstbase` format is different: same dict plus `_base_id` and
  `_version` (currently `1`), then cbor2 → brotli → zstd. **We target `.json` only.**

## 2. Naming conventions — corrects CLAUDE.md's original hints

- `WorldLocation`, `WorldRotation`, `WorldScale3D`, `MapObjectInstanceId` appear
  **nowhere** in the PST repo. The CLAUDE.md §0.2 hint list predates this research.
- Decoded `RawData` fields are **snake_case**. The one PascalCase survivor seen:
  `MapObjectId` — e.g. `{'id': None, 'value': 'PalBoxV2', 'type': 'NameProperty'}`.
  (`'PalBoxV2'` is our first object-type vocabulary entry candidate.)

## 3. Per-object fields (map object → `Model.value.RawData.value`)

From `map_model.py` `decode_bytes`:

```
instance_id                              guid
concrete_model_instance_id               guid
base_camp_id_belong_to                   guid
group_id_belong_to                       guid
hp                                       {current, max}
initital_transform_cache                 ftransform  ← game's own typo "initital", preserve verbatim
repair_work_id                           guid
owner_spawner_level_object_instance_id   guid
owner_instance_id                        guid
build_player_uid                         guid
interact_restrict_type                   byte
deterioration_damage                     float
stage_instance_id_belong_to              {id, valid}
```

`ConcreteModel.value.RawData.value`: `instance_id`, `model_instance_id`,
`concrete_model_type` (e.g. `'PalMapObjectBaseCampPoint'`) plus type-specific
extras dispatched on `concrete_model_type` (e.g. `current_recipe_id`,
`stored_energy_amount`). Container modules live under `ConcreteModel.ModuleMap`,
keyed by names containing `'ItemContainer'`, resolved via `target_container_id`.

## 4. Transform shape (likely answers "rotation encoding")

```python
ftransform = {'rotation': {x, y, z, w},      # quaternion
              'translation': {x, y, z},
              'scale3d': {x, y, z}}
```

Used for `BaseCampSaveData.transform`, `initital_transform_cache`,
`WorkerDirector.spawn_transform`. **Position is always `transform.translation`;
rotation is a quaternion.** Still to derive from the fixture: units, axes,
grid pitch, vertical pitch, discrete rotation steps, wall offset.

## 5. Linkage (the CLAUDE.md §0.2 "highest-risk unknown") — largely mapped

The export is a **complete base bundle**, not map-objects-only. Chest inventories
(`item_containers`), work entries (`works`), worker Pals (`characters`), and worker
slots (`char_containers`) all travel with the file, cross-referenced by GUID.

On **import**, PST regenerates (fresh `uuid4`): base ID, worker-container ID, every
map object's `instance_id` + `concrete_model_instance_id` (except the palbox model
ID, deliberately kept), every work `id` (cross-refs rewritten:
`target_work_id`, `work_ids`, `owner_map_object_model_id`,
`owner_map_object_concrete_model_id`), every `target_container_id`, dynamic-item
`local_id_in_created_world`, and worker-Pal `InstanceId`. It strips
`cached_base_camp_id` / `cached_base_camp_ptr` / `cached_base_index` from works,
applies a uniform translation offset to all positions (rotation/scale untouched),
rewrites `group_id_belong_to` to the target guild, and optionally re-derives HP.
Any map object referencing a work/container ID missing from the bundle is
**silently skipped** on import.

### Consequences for MapPal

- **Phase 1 (transform-only) is even safer than hoped:** PST's importer already owns
  ID remapping wholesale. We move `translation` / `rotation` values and preserve
  everything else verbatim.
- **Duplicate (Phase 1) caution:** PST remaps IDs via a dict keyed by *old* ID —
  two objects sharing an old `instance_id` would collapse to one mapping. Fresh
  UUIDs for duplicated objects, applied consistently across `instance_id`,
  `concrete_model_instance_id`, and any module `target_container_id` + the matching
  `item_containers` / `works` entries, are on us. This needs the fixture to pin down.
- **Delete caution:** deleting a map object should also drop (or at least warn about)
  its referenced `works` / `item_containers` entries — orphans are probably harmless
  on import (PST skips objects with dangling refs, not dangling data), but verify.
- PST's export deliberately **skips** `PalBooth`/`ItemBooth` objects and un-hatched
  `PalEgg*` ("known issues" per source comment) — don't be surprised when they're
  absent from exports.

## 6. Open questions the fixture must still answer

- Actual JSON shape as *serialized* (the GVAS property wrappers: `.value`, `.type`
  nesting) — the code shows decoded Python dicts; the on-disk JSON nesting must be
  observed directly.
- Units, axes, grid pitch, vertical pitch, rotation step values, wall offset.
- Object-type string vocabulary (`MapObjectId` values) for the calibration pieces.
- Whether editing only `translation`/`rotation` inside `map_objects` survives
  re-import + in-game load (Definition of Done, CLAUDE.md §10).
