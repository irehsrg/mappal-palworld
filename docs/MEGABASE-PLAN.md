# Mega base build plan — functional-only skyscraper

> Distilled 2026-07-18 from Val Stride's all-in-one skyscraper build guide
> (pre-1.0 video), stripped to the functional skeleton per Alex's preference.
> The aesthetic cladding (~60% of the video's effort: stepped clean/glass
> exterior, balconies, sports bar, penthouse, mini bar, library) is DROPPED —
> it can be layered on later with editor fills if ever wanted.

## Pathing rules that MUST survive (the real lessons in the video)

1. **Stair pattern is exact**: 2 stairs up → 2×2 landing → 2 stairs, repeated,
   wrapping the central shaft. Deviating breaks pal pathing to upper floors.
2. **Never place a wall directly under stairs** — known pathing bug, pals
   refuse to ascend.
3. **Leave a 2×2 floor cutout above every stair run** on each level.
4. Railings on elevated platforms (pals fall off otherwise) — use fences.

## Constraints the editor deletes (don't imitate these video steps)

- "Crates before floor above" ordering — irrelevant, place in any order.
- Delete-stairs-to-place-tiles-then-restore dance — irrelevant.
- Triple-jump boots / stamina / falling deaths — irrelevant.
- Water-building pillar-every-2-tiles support rule — worth *respecting* in
  the file anyway (place the pillars) since the game may validate support.

## The build, phase by phase

Deck footprint: **14×14 tiles** (fits inside the existing radius-8 circular
platform, which stays as the ground pad). Palbox already centered (4-corner
junction). Story height: video uses 4 wall-heights for floors 1–5 and 9, and
8 wall-heights for 6–8. Watch the height guardrail; if the ~16-tile limit
bites, compress stories to 2–3 wall-heights each — pals don't care.

- **Phase 0 — ground pad**: done (circular metal platform + Fill Circle
  top-up). Perimeter wall 1 high around the pad edge if desired.
- **Phase 1 — central shaft**: 4 pillars at the corners of the palbox's 2×2,
  extended per story. Wrap the stair pattern (rules above) around the shaft
  all the way up. Keep shaft interior open (no floor tiles inside the 2×2).
- **Phase 2 — template deck, then clone**: build ONE story slab: 14×14 floor
  (roof pieces as flooring), 2×2 stair cutout, perimeter wall (any material —
  glass if you want light, stone if you want cheap), railings at the cutout.
  Then: marquee-select the whole deck → Ctrl+D → PgUp to the next story
  height. Repeat for all 9 stories. Minutes, not evenings.
- **Phase 3 — per-floor structures** (functional list only):
  - **L1 ground**: 3×3 entrance cutouts on two opposite corners. Nothing else.
  - **L2 storage**: two rows of storage blocks along the back wall (crates
    stamped straight from the palette), fence + stairs for the balcony row.
  - **L3**: skip (video only adds a decorative catwalk).
  - **L4 production**: assembly lines + one 4-block storage row; two 3×4
    catwalk platforms with the double-stair access pattern.
  - **L5 wood/skillfruit**: 2-tile-wide rim platform around the perimeter,
    5-tile connector from the central stairs, one 2×2 + double-stair access.
  - **L6 gold assembly**: no structure — just stamp coin assembly lines.
  - **L7 crops/food** (the fiddly one): 2×4 storage block at the back wall;
    2×2 step-up block with opposed stairs; two 3×4 platforms at opposite
    ends; 3×5 platform off the first stair landing; large floating furnace
    platform off the second landing (to front wall, 6 toward right, 4 back);
    top-landing walkway along the rear wall ending in 3×3. Railings on all.
  - **L8 pal pods**: full-width 2-tile platform along the front wall, double
    stairs at both ends, pods on top, disassembly conveyors underneath.
  - **L9**: skip entirely (penthouse/lounge — pure aesthetics). Optionally
    stamp beds/hot springs here instead as a pal recovery floor.
- **Phase 4 — stations & furniture**: stamp from the palette per floor:
  assembly lines (L4), coin lines (L6), farms/furnaces (L7), pods+conveyors
  (L8), feed box + chests near palbox, guild chest. All 353 types trusted.
- **Phase 5 — export & deploy**: export → dress rehearsal import in a
  throwaway world (also validates the replace-flow) → fresh main-world
  backup → in PST: DELETE the original base → import the finished file →
  save. Lands at its own coordinates.

## Open questions to settle during the build

- Height budget: 9 video-stories vs the ~16-tile community limit — watch the
  sidebar height guardrail; compress story heights if the count goes red.
  (The limit figure is community lore, unverified in 1.0.)
- Sky-island / water pieces from 1.0 aren't in the video; ignore for v1 of
  the tower.
