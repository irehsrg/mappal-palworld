// Small anchored popover used by the top toolbar (Header.tsx) to host the
// three build-tool panels (Circle / Stack / Relocate) without permanently
// occupying sidebar real estate — user feedback was that the sidebar was
// "overloaded"; these tools are used occasionally, not continuously, so they
// get a click-to-reveal home instead of always-visible space.
//
// Controlled by the parent (Header.tsx keeps a single `activeTool` string so
// opening one popover closes any other already open — standard toolbar
// behavior, avoids a wall of stacked popovers).
//
// Closes on Escape or an outside click. The Escape handler runs in the
// CAPTURE phase on `document` and calls stopPropagation, so it wins the race
// against useKeyboardControls.ts's window-level (bubble-phase) Escape
// handler — otherwise closing a popover with Escape would also disarm place
// mode / clear the canvas selection in the same keystroke, which is exactly
// the "don't steal keyboard from the canvas otherwise" brief: Escape should
// close JUST the popover, leaving the canvas's own Escape semantics for the
// next press.
import { useEffect, useRef, type ReactNode } from "react";

export interface ToolPopoverProps {
  label: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function ToolPopover({ label, title, open, onOpenChange, children }: ToolPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    // Capture phase, ahead of useKeyboardControls.ts's bubble-phase window
    // listener — see file header.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div className="tool-popover" ref={rootRef}>
      <button
        type="button"
        className={`tool-popover__trigger${open ? " tool-popover__trigger--active" : ""}`}
        onClick={() => onOpenChange(!open)}
        title={title}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="tool-popover__panel" role="dialog" aria-label={title ?? label}>
          {children}
        </div>
      )}
    </div>
  );
}
