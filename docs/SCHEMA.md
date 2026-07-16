# Blueprint schema — annotated (observed in fixtures/calibration_01.json)

> Every field below was personally observed in the fixture (PST v2.1.0 export).
> Fields marked `UNKNOWN` are preserved verbatim and never touched (CLAUDE.md §4).
> `docs/PST-EXPORT-HINTS.md` has the PST-source-side view; this file is the
> on-disk truth.

## Top level

```jsonc
{
  "base_camp":       { "key": "<guid>", "value": { /* BaseCampSaveData */ } },
  "base_camp_level": 1,                 // int
  "map_objects":     [ /* 22 entries, see below */ ],
  "characters":      [],                // working Pals (empty — none assigned)
  "item_containers": [ /* 3 entries */ ],
  "char_containers": [ /* 1 entry: worker slots */ ],
  "works":           [ /* 14 entries */ ],
  "dynamic_items":   []
}
```

PST's own version check: a file missing `dynamic_items` or `base_camp_level`
is rejected as "old blueprint". Our loader mirrors this exact check.

## GVAS property wrapper convention

Everything nests in typed property wrappers:
`{"id": null, "value": <payload>, "type": "NameProperty" | "StructProperty" | ...}`,
structs add `struct_type` / `struct_id`, arrays add `array_type`. Binary blobs
appear as `{"~b": "<base64>"}` (`trailing_bytes`, `CustomVersionData`,
`unknown_bytes`) — **opaque, preserve byte-for-byte.**

## map_objects[i]

```jsonc
{
  "MapObjectId": { "id": null, "value": "Wooden_foundation", "type": "NameProperty" },
  "Model": {                       // struct_type: PalMapObjectModelSaveData
    "value": {
      "BuildProcess": { /* state int + opaque blobs — UNKNOWN, preserve */ },
      "Connector": {               // struct_type: PalMapObjectConnectorSaveData
        "value": { "RawData": { "value": {
          "supported_level": -1,   // UNKNOWN meaning
          "connect": {
            "index": 254,          // UNKNOWN meaning
            "any_place": [ { "connect_to_model_instance_id": "<guid>", "index": 254 } ]
          },
          "unknown_bytes": [0,0,0,0]
        }}}
      },
      "EffectMap": { /* empty MapProperty in fixture — UNKNOWN, preserve */ },
      "Paint":     { /* opaque blob — UNKNOWN, preserve */ },
      "RawData": { "value": {      // ← the fields we understand
        "instance_id": "<guid>",
        "concrete_model_instance_id": "<guid>",
        "base_camp_id_belong_to": "<guid>",   // == base_camp.key
        "group_id_belong_to": "<guid>",       // guild
        "hp": { "current": 3993, "max": 4000 },
        "initital_transform_cache": {          // sic — game's typo, emit verbatim
          "rotation":    { "x": 0, "y": 0, "z": -0.794, "w": 0.608 },  // quat
          "translation": { "x": -353520.0, "y": 271455.7, "z": 7140.7 }, // cm
          "scale3d":     { "x": 1, "y": 1, "z": 1 }
        },
        "repair_work_id": "<guid>",           // → works[].RawData.value.id
        "owner_spawner_level_object_instance_id": "<guid, usually zero>",
        "owner_instance_id": "<guid, usually zero>",
        "build_player_uid": "<guid>",
        "interact_restrict_type": 1,          // UNKNOWN meaning
        "deterioration_damage": 0.0,
        "stage_instance_id_belong_to": { "id": "<guid>", "valid": 3610003712 }, // UNKNOWN
        "unknown_bytes": [ /* ints — preserve */ ]
      }},
      "CustomVersionData": { /* opaque, preserve */ }
    }
  },
  "ConcreteModel": {               // struct_type: PalMapObjectConcreteModelSaveData
    "value": {
      // TWO SHAPES EXIST (discovered 2026-07-16 via export lint):
      // 1. "Smart" objects (chest, workbench, palbox, …): RawData.value has
      //    instance_id / model_instance_id / concrete_model_type + extras,
      //    and Model.RawData.concrete_model_instance_id cross-references it.
      // 2. Plain structural pieces (foundations, walls, pillars, roofs, …):
      //    Model.RawData.concrete_model_instance_id is the ZERO GUID and
      //    RawData.value is just {"values": <opaque>} with NO id fields.
      //    Preserve verbatim; never mint concrete ids for these (C4).
      "RawData": { "value": {
        "instance_id": "<guid>",   // == concrete_model_instance_id above (shape 1 only)
        "model_instance_id": "<guid>",  // == Model instance_id (backref, shape 1 only)
        "concrete_model_type": "PalMapObjectBaseCampPoint" // etc. (shape 1 only)
        /* + type-specific fields — treat all as UNKNOWN except observed ones */
      }},
      "ModuleMap": { "value": [    // present on objects with behaviours
        { "key": "EPalMapObjectConcreteModelModuleType::ItemContainer",
          "value": { "RawData": { "value": {
            "target_container_id": "<guid>",  // → item_containers[].key.ID.value
            "slot_attribute_indexes": [ { "attribute": 2, "indexes": [0] } ]  // UNKNOWN
          }}}},
        // also observed: ...ModuleType::StatusObserver (opaque), ::Energy (on base_camp)
      ]}
    }
  }
}
```

## item_containers[i]

`key.ID.value` = the GUID that `target_container_id` points at.
`value`: `BelongInfo` (GroupId + bControllableOthers), `Slots` (array of
`PalItemSlotSaveData` — empty in fixture), `SlotNum` (int), `RawData.value`
(`permission` lists + `trailing_unparsed_data` — preserve), `CustomVersionData`.

## works[i]

`WorkableType` (enum, e.g. `EPalWorkableType::Repair`), `WorkAssignMap`
(empty in fixture), `RawData.value`:

- `id` — the GUID `repair_work_id` points at
- `workable_bounds.box_sphere_bounds.box_extent` — half-extents of the owner
  object (usable as proxy dimensions!)
- `base_camp_id_belong_to`, `owner_map_object_model_id`,
  `owner_map_object_concrete_model_id` — backrefs
- `transform`: `{ "type": 2, "map_object_instance_id": "<guid>", ... }` —
  relative-to-object; follows the object automatically on move
- `assign_define_data_id` (e.g. `"RepairBuildObject_0"`), plus ~10 more fields —
  meanings UNKNOWN, preserve verbatim

## char_containers[i]

`key.ID.value` GUID (worker-slot container for the base). Contents UNKNOWN —
preserve verbatim.

## base_camp

`key` = base GUID; `value` includes a `ModuleMap` keyed by
`EPalBaseCampModuleType::*` (9 modules, e.g. `::Energy`) — all UNKNOWN,
preserve verbatim.
