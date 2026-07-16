# Extracting real building models from Palworld (for local use)

> Researched 2026-07-16 against game v1.0.1.100619. Assets extracted from your
> own install, loaded locally by MapPal — never committed to this repo and not
> part of any public deploy unless a deliberate decision is made later.

## The short version

FModel (the standard UE asset explorer) opens Palworld's pak unencrypted; you
need one community "mappings" file because it's UE5. Building pieces are
defined as `BP_BuildObject_*` Blueprints whose names line up with our
`MapObjectId`s; each Blueprint references its StaticMesh. Export the meshes as
glTF, batch-dump the Blueprints as JSON, and `tools/` can generate the
`MapObjectId → mesh` manifest automatically.

Nobody has built a public Palworld *building* renderer before (creature-model
extraction is routine, buildings aren't) — so MapPal's manifest is new ground.

## One-time setup (~10 min)

1. Download FModel (`dec-2025` release or newer): https://fmodel.app/ —
   that release matters: it added Nanite static-mesh export, which UE5 games use.
2. Download the mappings file `Mappings.usmap`:
   https://github.com/PalworldModding/UsefulFiles/raw/refs/heads/master/Mappings.usmap
   — verified updated **2026-07-10, "Update Mapping to 1.0"**, matching our
   game build. (Do NOT use elliotks/Palworld-FModel — archived, pre-1.0 only.
   Fallback if a future hotfix breaks it: self-dump via UE4SS Dumper tab.)
3. In FModel: Directory → Selector → "Add Undetected Game" → directory
   `...\steamapps\common\Palworld` (the folder containing `Engine` and `Pal`);
   UE Versions = `GAME_UE5_1`; Settings → General → enable **Local Mapping
   File** → point at the `.usmap`. Leave the AES field blank (not needed).
4. Settings → Models: Texture Format = **PNG**. Mesh Format — two routes:
   - **Quick:** `glTF2` directly. Works, but is the less battle-tested path.
   - **Robust (FModel devs' recommendation):** `UEFormat (uemodel)`, then the
     UEFormat Blender plugin (github.com/Buckminsterfullerene02/UEFormat) →
     Blender → export glTF Binary (.glb). Use this if a direct-glTF mesh
     looks wrong (UVs/materials).

## Per-export session (~20 min for all building pieces)

5. Browse to `Pal/Content/Pal/Blueprint/MapObject/BuildObject/` — this is the
   canonical list of every buildable (`BP_BuildObject_...`). Right-click the
   folder → batch-export the packages' **Properties (JSON)**. These JSONs
   contain each buildable's StaticMesh reference — MapPal's manifest generator
   consumes them.
6. Open one Blueprint's JSON, note the StaticMesh path it references — that
   reveals the real Model folder. Right-click that mesh folder → **Save
   Folder's Packages Models** (+ Textures) to export `.glb` files.
7. Optional palette icons: `Pal/Content/Pal/Texture/UI/InGame` →
   `T_icon_construction_tab_*` textures as PNG.
8. Put everything under `assets-local/` in this project (gitignored):
   `assets-local/blueprints/*.json`, `assets-local/models/*.glb`,
   `assets-local/icons/*.png`.

## Known pitfalls (from the modding community's own docs + Epic's glTF docs)

- Blender import of UE assets: scale 0.01, "Add Leaf Bones" off.
- UE materials only approximate to glTF PBR — expect some texture slot fixing;
  normal maps may need a green-channel flip. glTF keeps max 2 UV channels,
  needs full-precision UVs, exports no collision and a single LOD (all fine
  for viz). Runtime paint/weathering overlays won't survive — you get the
  clean material, not in-game decay.
- `DT_MapObjectAssignData` is Pal work-assignment data, NOT an ID→mesh table —
  the mesh reference lives inside each BuildObject Blueprint, hence the
  batch-JSON approach. The building static-mesh folder itself is publicly
  undocumented: open any `BP_BuildObject_*` blueprint, its StaticMeshComponent
  reference reveals the real folder (5 minutes, firsthand ground truth).
- ID ↔ blueprint matching heuristic: `BP_BuildObject_<Name>` suffixes mirror
  item IDs (e.g. `BP_BuildObject_WorkBench_SkillUnlock` ↔ our
  `WorkBench_SkillUnlock` donor) — strong pattern, verify per piece.
- For a fully scripted alternative to manual FModel clicking:
  github.com/PalworldDataTools/PalworldDataExtractor is a CUE4Parse-based
  .NET CLI/library that already dumps Palworld DataTables to JSON — could be
  extended to dump `DT_ItemDataTable` + BuildObject blueprints headlessly.

## What MapPal does with it (to be built)

- `tools/gen-mesh-manifest.ts`: parse `assets-local/blueprints/*.json` →
  `assets-local/manifest.json` (`MapObjectId → {mesh, icon, name}`).
- Scene: load `.glb` per manifest entry (drei useGLTF), fall back to the
  parametric proxy shapes for anything unmapped or when `assets-local/` is
  absent. Zero assets in the repo; the loader ships, the models don't.

Sources: pwmodding.wiki (FModel setup, export tutorial),
palworld.wiki.gg/wiki/Game_Files/Guide (pak paths), github.com/4sval/FModel
(releases/wiki), PalworldModding/UsefulFiles (mappings).
