# Fixtures — provenance

Per CLAUDE.md §0.1: every fixture records the exact PST version and game
version it was exported from. Fixtures are test data — never edit by hand.

| File | PST version | Save format (PST UI) | Game version | Exported | Contents |
|---|---|---|---|---|---|
| `calibration_01.json` | v2.1.0 | 1.0.1 | Win S v1.0.1.100619 (Steam, Windows, mods active) | 2026-07-16 | Calibration base: palbox, 10 wooden foundations (row of 5 + L + starter platform), 3 walls, 2 stacked pillars + roof, chest, workbench, pal bed, 1 dropped-item bag, 1 world rock. Round-trip verified in-game 2026-07-16. |
| `sampler_01.json` | v2.1.0 | 1.0.1 | Win S v1.0.1.100619 (Steam, Windows, mods active) | 2026-07-16 (re-exported twice same day, superset each time) | Donor sampler base (id ee3263ad): one of each structural piece across Wood, Stone, Metal/Iron, SF, JapaneseStyle, and Ancient kits; factory benches, blast furnaces, ore pits, mills, stations, beds. Placed pieces not yet verified in-game. |
| `sampler_02.json` | v2.1.0 | 1.0.1 | Win S v1.0.1.100619 (Steam, Windows, mods active) | 2026-07-16 | Second donor sampler (id 3eb204c1): storage (shelves/boxes/barrels/chest tiers/guild+pal storage), utility (lab, breeding hatchery, operating table, altar, statues, expedition, viewing/rank-up), conveyors, cooking stoves. Alex: covers all production except basic oil extractor, pal items, and cooking tabs. Placed pieces not yet verified in-game. |
