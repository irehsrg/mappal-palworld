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
   https://github.com/PalworldModding/UsefulFiles/blob/master/Mappings.usmap
   (alternates: elliotks/Palworld-FModel has per-build versions;
   TheNaeem/Unreal-Mappings-Archive; or self-generate via UE4SS Dumper).
3. In FModel: add game → directory `...\steamapps\common\Palworld`;
   Settings → General → UE Versions = `GAME_UE5_1`; enable **Local Mapping
   File** → point at the `.usmap`. Leave the AES field blank (not needed).
4. Settings → Models: Mesh Format = **glTF2**, Texture Format = **PNG**,
   Level of Detail = **First Level Only**.

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

## Known pitfalls (from the modding community's own docs)

- The community's battle-tested path is ActorX (.psk) → Blender → FBX/glTF;
  FModel's direct glTF2 export exists but is less proven for Palworld
  specifically. Try glTF first; fall back to Blender (import scale 0.01,
  "Add Leaf Bones" off) if a mesh looks wrong.
- UE materials only approximate to glTF PBR — expect some texture slot fixing;
  normal maps may need a green-channel flip.
- `DT_MapObjectAssignData` is Pal work-assignment data, NOT an ID→mesh table —
  the mesh reference lives inside each BuildObject Blueprint, hence the
  batch-JSON approach.

## What MapPal does with it (to be built)

- `tools/gen-mesh-manifest.ts`: parse `assets-local/blueprints/*.json` →
  `assets-local/manifest.json` (`MapObjectId → {mesh, icon, name}`).
- Scene: load `.glb` per manifest entry (drei useGLTF), fall back to the
  parametric proxy shapes for anything unmapped or when `assets-local/` is
  absent. Zero assets in the repo; the loader ships, the models don't.

Sources: pwmodding.wiki (FModel setup, export tutorial),
palworld.wiki.gg/wiki/Game_Files/Guide (pak paths), github.com/4sval/FModel
(releases/wiki), PalworldModding/UsefulFiles (mappings).
