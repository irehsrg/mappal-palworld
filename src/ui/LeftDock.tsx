// Left-edge dock (user feedback: "Levels should live on the LEFT edge") —
// full-height, houses LevelsPanel.tsx, collapsible to a thin strip via the
// chevron button. Collapsed state persists in localStorage, same pattern as
// Palette.tsx's section open/closed state.
//
// Also publishes its current width as the `--left-dock-width` CSS custom
// property on the document root, so VisibilityBanner (rendered as a sibling
// over the canvas, see App.tsx/index.css) can offset itself right of the
// dock without either component needing to know about the other's React
// state directly.
import { useEffect, useState } from "react";
import { LevelsPanel } from "./LevelsPanel";

const STORAGE_KEY = "mappal.leftDock.collapsed";
const EXPANDED_WIDTH = "240px";
const COLLAPSED_WIDTH = "32px";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage unavailable — default to expanded.
    return false;
  }
}

export function LeftDock() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Best-effort persistence only.
    }
  }, [collapsed]);

  // Keep VisibilityBanner's offset in sync with the dock's actual rendered
  // width, and reset to 0 on unmount (dock only renders while a blueprint is
  // loaded — App.tsx — so an unloaded file shouldn't leave a stale offset).
  useEffect(() => {
    document.documentElement.style.setProperty("--left-dock-width", collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH);
    return () => {
      document.documentElement.style.setProperty("--left-dock-width", "0px");
    };
  }, [collapsed]);

  return (
    <div className={`left-dock${collapsed ? " left-dock--collapsed" : ""}`}>
      <button
        type="button"
        className="left-dock__toggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Expand levels panel" : "Collapse levels panel"}
        aria-expanded={!collapsed}
      >
        {collapsed ? "»" : "«"}
      </button>
      {!collapsed && (
        <div className="sidebar left-dock__content">
          <LevelsPanel />
        </div>
      )}
    </div>
  );
}
