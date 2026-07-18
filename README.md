# MapPal — Palworld Base Blueprint Editor

> ## ⚠️ Back up your save first
> Before importing anything this tool produced, copy your world folder
> (`%LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<WorldID>`) somewhere safe.
> Palworld also keeps rolling backups in each world's `backup\world\` folder —
> know where they are before you need them.

A browser-based 3D editor for Palworld base layouts. Load a base blueprint
exported by PalworldSaveTools, move/rotate/duplicate/delete objects in a 3D
scene, export a blueprint PST can import back. Built for planning mega-bases
out of game.

**MapPal never touches a `.sav` file.** All save I/O is done by
[PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools)
(PST) by deafdudecomputers — MapPal only reads and writes PST's blueprint
JSON. Schema understanding builds on the GVAS structure work in
[palworld-save-tools](https://github.com/cheahjs/palworld-save-tools) by cheahjs.

## Workflow

1. **Export**: PST → load your world's `Level.sav` → Map Viewer → right-click
   your base → *Export Base* → save as **plain `.json`** (not `.pstbase`).
2. **Edit**: open MapPal, drag the `.json` in. Click to select (shift-click to
   add), arrow keys move on the base's snap grid, PgUp/PgDn change height,
   Q/E rotate 90°, Ctrl+D duplicates, Delete removes, Ctrl+Z/Y undo/redo.
3. **Export**: the Export button downloads `<name>_edited.json`.
4. **Import**: close Palworld completely → PST → load the **destination**
   world → Map Viewer → right-click → *Import Base* → pick the file →
   **save in PST** → close PST → launch the game.

### The three rules (each one learned the hard way)

- **Never import into the world the export came from.** The game silently
  deletes the imported structures on next load (PST leaves the imported
  work-data bound to the original base's ID). Export from world A, import
  into world B. Your main world can be the destination — an import only
  *adds* a base, it never resets anything.
- **The game must be fully closed** whenever PST saves. A running game
  ignores the change and overwrites it on its next save.
- **Imports land ~80 m away from the blueprint's original coordinates**
  (collision-avoided), as a new base. Look for the new palbox on the map.

## Status

v0.1 — the full loop (load → edit → export → PST import → verified in-game)
works. Editing is transform-only: you can move, rotate, duplicate, and delete
objects that exist in the blueprint, but not place new object types from a
palette (that's Phase 2, see `CLAUDE.md`). Derived format ground truth lives
in `docs/CALIBRATION.md`.

## Development

```
npm install
npm run dev        # editor at http://localhost:5173
npm test           # incl. round-trip fidelity tests against fixtures/
npm run inspect <file.json>   # schema-agnostic blueprint dumper
```

Stack: Vite, TypeScript (strict), React, @react-three/fiber, zustand, vitest.

## Credits

- [PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools)
  (deafdudecomputers) — the save-editing toolkit MapPal depends on for all
  save I/O; its Export/Import Base feature defines the blueprint format.
- [palworld-save-tools](https://github.com/cheahjs/palworld-save-tools)
  (cheahjs) — the community-standard GVAS parser underpinning the ecosystem.
- Not affiliated with Pocketpair. No game assets are included in this
  repository.

## License

[MIT](LICENSE)
