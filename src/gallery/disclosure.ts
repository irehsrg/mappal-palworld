// Publish-time privacy disclosure (docs/GALLERY.md "disclose, never
// transform"). PST exports carry player-identifying fields; before a base
// leaves the machine we tell the user exactly what's in theirs. We never
// strip or rewrite anything — mutating opaque fields risks a file that
// imports broken (CLAUDE.md C5), so the tool warns and the user decides.
//
// Field names below are grounded in real exports (C4), observed in
// fixtures/calibration_01.json and the 7,700-piece tower export:
//   - map_objects[].Model.value.RawData.value.build_player_uid
//   - map_objects[].ConcreteModel.value.RawData.value.pickupdable_player_uid
//   - map_objects[].ConcreteModel.value.RawData.value.private_lock_player_uid
//   - top-level `characters` array (pals; empty in both fixtures, but
//     multiplayer worlds may differ)
//   - base_camp.value.RawData.value.name (base camp name string)
// The scan is generic over any key ending in `_player_uid` so future PST
// fields with the same convention are surfaced rather than missed.

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

export interface PublishDisclosure {
  /** Entries in the top-level `characters` array (pals, possibly with owner data). */
  characterCount: number;
  /** Distinct non-zero values of every `*_player_uid` field in the file. */
  playerUids: string[];
  /** The base camp's stored name, if present (defaults to a JP template string). */
  campName: string | null;
}

export function scanForPersonalData(raw: unknown): PublishDisclosure {
  const uids = new Set<string>();

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.endsWith("_player_uid") && typeof value === "string" && value !== ZERO_GUID) {
          uids.add(value);
        }
        walk(value);
      }
    }
  }
  walk(raw);

  const root = raw as {
    characters?: unknown[];
    base_camp?: { value?: { RawData?: { value?: { name?: unknown } } } };
  };
  const campNameRaw = root.base_camp?.value?.RawData?.value?.name;

  return {
    characterCount: Array.isArray(root.characters) ? root.characters.length : 0,
    playerUids: [...uids].sort(),
    campName: typeof campNameRaw === "string" && campNameRaw.length > 0 ? campNameRaw : null,
  };
}
