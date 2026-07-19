// Left-edge dock (user feedback: "Levels should live on the LEFT edge") —
// full-height, houses LevelsPanel.tsx, collapsible to a thin strip via the
// chevron button, and RESIZABLE by dragging its right edge (user feedback:
// the fixed width crushed level labels). Width + collapsed state persist in
// localStorage.
//
// Publishes its current width as the `--left-dock-width` CSS custom property
// on the document root, so VisibilityBanner (rendered as a sibling over the
// canvas, see App.tsx/index.css) can offset itself right of the dock without
// either component needing to know about the other's React state directly.
import { useEffect, useRef, useState } from "react";
import { LevelsPanel } from "./LevelsPanel";

const COLLAPSED_KEY = "mappal.leftDock.collapsed";
const WIDTH_KEY = "mappal.leftDock.width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 280;
const COLLAPSED_WIDTH = 32;

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
  } catch {
    /* fall through */
  }
  return DEFAULT_WIDTH;
}

export function LeftDock() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [width, setWidth] = useState(loadWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Best-effort persistence only.
    }
  }, [collapsed, width]);

  useEffect(() => {
    const px = collapsed ? COLLAPSED_WIDTH : width;
    document.documentElement.style.setProperty("--left-dock-width", `${px}px`);
    return () => {
      document.documentElement.style.setProperty("--left-dock-width", "0px");
    };
  }, [collapsed, width]);

  // Right-edge resize: plain pointer capture on the handle. Movement is
  // clamped live; state persists via the effect above.
  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
  }
  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const next = dragRef.current.startWidth + (e.clientX - dragRef.current.startX);
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  }
  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  return (
    <div
      className={`left-dock${collapsed ? " left-dock--collapsed" : ""}`}
      style={collapsed ? undefined : { width }}
    >
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
        <>
          <div className="sidebar left-dock__content">
            <LevelsPanel />
          </div>
          <div
            className="left-dock__resize"
            title="Drag to resize"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
          />
        </>
      )}
    </div>
  );
}
