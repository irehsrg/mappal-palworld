# MapPal: building a 3D base editor for a game with an undocumented save format

![The ~7,700-piece skyscraper in the editor](media/tower-hero.png)

Palworld has a mature save-editing ecosystem, and every tool in it is a table.
PalworldSaveTools, palworld-save-pal, Pal-Editor — they all show your base as a
list of objects and dots on a map. Nobody had built the thing Terraria players
have had for years in TerraMap: a spatial editor. If you wanted to plan a
mega-base, you did it in-game, one piece at a time, with the build UI fighting
you the whole way.

So I built [MapPal](https://mappal-palworld.vercel.app): a browser-based 3D
editor that loads a base blueprint exported by PalworldSaveTools (PST), lets
you move, rotate, duplicate, delete, and place objects, and exports a blueprint
PST can import back into a real save. The interesting parts weren't the
three.js scene. They were the decisions about what the tool would refuse to do.

## Rules before code

Before writing any features, I wrote five hard constraints. The important ones:

**Never touch a `.sav` file.** Palworld's save format changes with game
updates and has broken community tooling before. PST already absorbs that
maintenance burden — its Export Base feature emits a blueprint JSON, and its
importer knows how to remap IDs. MapPal is a lens on that JSON and nothing
more. When the game updates and the save format shifts, that's PST's problem,
by design.

**Never invent a schema field.** The blueprint format is undocumented. I had
hints about what PST's source emits, but the rule was: every field name in the
codebase comes from a real export file, or it doesn't exist. A
plausible-looking wrong field name is the single most likely way a tool like
this quietly corrupts someone's base. Where a field's meaning was opaque, the
model preserves it verbatim in a `_raw` passthrough blob and never touches it.

**Round-trip fidelity above features.** Load a file, export it with zero
edits, and the output must be semantically identical to the input. An export
that corrupts a base is worse than no tool. This one earned its keep on day
one: the very first round-trip test caught JavaScript silently rewriting
Python's `-0.0` floats to `0`. That's exactly the class of bug you never find
by eyeballing a 3D scene.

## Calibration: derive, don't guess

The first phase of the project wasn't code — it was measurement. I built a
deliberate calibration base in-game: a palbox, a row of five foundations, an
L-corner, stacked pillars, three walls at three rotations, a chest, a
workbench, a bed. Exported it through PST, committed the file as a fixture,
and wrote a CLI dumper to answer questions from the file instead of from
community folklore.

Folklore lost repeatedly:

- **Foundations are "2 m" according to every guide.** The file says adjacent
  flush foundation centres are exactly 400.0 Unreal units — 4 m — apart.
- **The snap grid is not world-axis-aligned.** Each group of connected pieces
  inherits an arbitrary yaw from the first piece placed (my calibration row
  sat at 164.11°, a second platform at 61.18°). One base can contain multiple
  independent grids, so the editor snaps per-connected-group in local frame,
  not to global XY.
- **Structures snap in 90° steps, furniture doesn't.** The three walls sat at
  exactly grid-yaw, grid−90°, grid+180°. The chest, bed, and workbench sat at
  arbitrary player-aimed angles. So the editor offers rotation snapping for
  furniture but never forces it.
- Vertical pitch is 325 units per wall segment; a wall's origin is at the
  foundation's edge midpoint, 200 units from centre.

The file also taught me things I'd never have thought to ask. The export
captures non-player-built objects that happen to sit inside the base radius —
dropped item bags, a damageable world rock — which must be preserved verbatim.
Object HP shows live deterioration (the chest was at 3993/4000), one more
reason never to regenerate values you don't understand. And the game's own
field name `initital_transform_cache` — typo and all — has to be emitted
exactly as-is.

![Box-select and mass editing](media/shift-highlight-demo.gif)

## The donor pattern

Moving existing objects is safe: you edit a transform and the object's web of
GUID references — its work entries, its item container, its connector links to
the host foundation — stays intact. *Creating* an object is a different
problem. A new chest isn't one JSON object; it's an object plus a container
entry plus a repair-work entry plus back-references, all linked by GUIDs, some
of which may live in parts of the save the blueprint doesn't even carry.

Instead of synthesizing objects from first principles, MapPal clones donors:
known-good objects harvested from real exports. Placing a wooden foundation
clones a real foundation's whole bundle, mints fresh GUIDs, rewrites the
owner references, and sets the transform. Types with no donor can't be placed,
and the palette says so honestly. The palette grows by someone building a
piece in-game and exporting it — slow, and correct. It now covers all 453 of
the game's buildable piece types.

## The incident that validated the design

The first in-game verification looked like a success and wasn't. Importing an
edited base back into the world it was exported from produced a base the game
silently deleted on next load. I decoded re-exports of all three bases
involved and did forensics on what actually survived.

Two mechanisms, both PST quirks on same-world import: imported work entries
keep their `base_camp_id_belong_to` pointing at the *original* camp, and PST
reuses the palbox's model instance ID, so the world ends up with duplicate
palboxes. The game's cleanup pass then deletes the entire imported network —
and the deletion propagates along the explicit connector links between
objects.

Exactly two objects survived, at their correct imported positions: a dropped
item bag, and the one chest MapPal had *duplicated* — the object with a fresh
GUID bundle and cleared connector links. The failure was the strongest
evidence I had that the duplicate/donor writeback design was right: everything
still wired into the old base's identity died, and the one object MapPal had
fully re-minted lived.

The operational lesson went straight into the README as a rule: never import
into the world the export came from. All verification since has been
cross-world — export from world A, import into a throwaway world B, load the
game, walk around the build.

Cross-world testing also let me kill another piece of folklore: a ~450-piece
tower — about 47 wall-heights tall — imported fully intact, refuting the
community's "~16-tile vertical build limit" at least for imports. The same
test exposed a real editor bug: my stair proxy geometry was mirrored versus
the game mesh, so stairs oriented by eye spawned backwards. In-game
verification catches what JSON diffing can't.

## Engineering the context, not just the code

Most of this project's code was written by an AI coding agent. My job was
writing the spec it worked from — and I mean a real spec, not a prompt: a
project brief with the five hard constraints, a calibration phase gated before
any feature work ("nothing else can be built correctly until this is done —
do not guess these numbers, derive them"), the schema rule ("if you find
yourself writing a field name you have not personally seen in the fixture,
stop and say so"), and an explicit instruction to prefer
`// UNKNOWN — needs calibration` over a confident guess.

That document did more work than any individual coding session. The agent is
excellent at producing plausible code, and in an undocumented-format project,
*plausible* is the failure mode — a guessed field name looks identical to a
real one until someone's base imports broken. The spec's job was to make
guessing feel wrong and "I don't know" feel right. When scope changed — I
later added an optional community gallery, which amended the "no backend"
constraint — the amendment went into the spec with a date and rationale, so
the rule stayed load-bearing instead of quietly eroding.

I've come to treat this as a first-class engineering activity: deciding what
the agent must never do, what it must derive before it builds, and what
evidence counts as verification. The code was often the easy part.

## Where it landed

The full loop works and is verified at scale: a ~7,700-piece skyscraper built
in the editor imported into a live world and spawned intact. Mass-editing
tools — line and rectangle fill, one-click circular platforms, vertical
stacking, rotate-a-wing-around-the-palbox — exist because 7,000-piece builds
demanded them; per-level hide/solo exists because you can't work on floor 12
with floors 13–47 in the way.

![Per-level hide/solo peeling the tower floor by floor](media/level-peel-demo.gif)

After a Reddit user asked for a way to share builds ("theres literally none
as far as i know"), I added a community gallery: Discord/GitHub sign-in,
publish a base publicly or save it privately, open any shared base straight in
the editor via link. The editor itself stays fully client-side — a blueprint
leaves your machine only when you explicitly publish, and the publish dialog
first shows exactly what player-identifying data the file carries. I
deliberately don't strip those fields: rewriting opaque data risks producing
a file that imports broken, so the tool discloses and the user decides. The
only analytics are anonymous funnel counters — the number I actually watch is
loads versus exports, which is the difference between a pretty landing page
and a tool people use.

## What I'd do differently

Start the forensic tooling earlier. I built the blueprint dumper in the
calibration phase, but the decoder for PST's compressed re-exports only got
written when the same-world incident forced it — and it's the tool that
turned "the import vanished, no idea why" into two specific, documented
mechanisms. In an undocumented-format project, the instrumentation for *when
things go wrong* is as much a day-one deliverable as the round-trip test.

And I'd distrust my own "verified" earlier. The first in-game check was an
observation of the wrong objects — the original base and two loose survivors —
made before I understood where imports land. A verification step you don't
fully understand isn't a verification step; it's a vibe. The gate that
finally counted was specific: cross-world import, walk to the new palbox,
find the moved chest at its new position with the duplicate beside it.
