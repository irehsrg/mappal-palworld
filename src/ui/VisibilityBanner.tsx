// Persistent status chip (task brief §5): whenever LevelsPanel.tsx has
// hidden or soloed a level, this floats over the viewport so a user never
// mistakes "filtered out of view" for "deleted" — objects.length / guardrail
// counts are completely unaffected (visibilityStore.ts is a viewport-only
// lens), but nothing else in the UI says so unless this is visible. Clicking
// it resets visibility, same action as LevelsPanel's own "show all".
import { anyLevelsHidden, useVisibilityStore } from "../scene/visibilityStore";

export function VisibilityBanner() {
  const hiddenLevels = useVisibilityStore((s) => s.hiddenLevels);
  const soloLevel = useVisibilityStore((s) => s.soloLevel);
  const showAll = useVisibilityStore((s) => s.showAll);

  if (!anyLevelsHidden(hiddenLevels, soloLevel)) return null;

  const label =
    soloLevel !== null
      ? `Showing L${soloLevel}±1`
      : `${hiddenLevels.size} level${hiddenLevels.size === 1 ? "" : "s"} hidden`;

  return (
    <button type="button" className="visibility-banner" onClick={showAll} title="Reset level visibility">
      {label} — show all
    </button>
  );
}
