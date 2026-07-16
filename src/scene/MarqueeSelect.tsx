// Shift+drag marquee (box) selection. Deliberately opt-in via a held
// modifier key — exactly like Q/E rotate or the arrow-key nudges elsewhere
// in this app use a key to select a different behaviour — so it never
// competes with plain-drag orbit (OrbitControls) or plain click-select
// (ObjectBox's onClick). Logic-only: renders nothing, just wires native
// pointer listeners onto the canvas and an imperative DOM overlay rectangle
// (same technique drei's own <Select box multiple> uses internally), then
// on release, unions any objects whose screen-space projection falls inside
// the rectangle into the current selection.
//
// Interaction hygiene with Phase 2 place mode (CLAUDE.md §6): shift+drag
// marquee is disabled entirely while a palette entry is armed (see the
// armedType check in onPointerDown below) rather than made to coexist with
// placement. Design choice, not a limitation of either feature — armed mode
// already repurposes plain click for "place, don't select", so a
// shift+drag-to-select gesture during the same session would be a second,
// harder-to-discover exception to "clicks place" rather than a clarifying
// one. Escape (or clicking the armed palette button again) disarms and
// marquee immediately works again.
//
// Orbit controls are disabled for the duration of the drag by setting
// `controls.enabled = false` synchronously in the pointerdown handler.
// OrbitControls itself only *applies* rotation in its pointermove handler
// (checking `enabled` at that point), so it doesn't matter whether our
// pointerdown listener races ahead of OrbitControls' own pointerdown
// listener — by the first pointermove, `enabled` is already false.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { PlacedObject } from "../model/types";
import { useEditorStore } from "../model/store";
import { ueVecToThree } from "./coords";
import { usePlaceModeStore } from "./placeModeStore";

export interface MarqueeSelectProps {
  objects: PlacedObject[];
  /** Scene-wide recentring offset (three.js space, metres) — see Scene.tsx. */
  centroidThree: THREE.Vector3;
}

const DRAG_THRESHOLD_PX = 6;

export function MarqueeSelect({ objects, centroidThree }: MarqueeSelectProps) {
  const { camera, gl, controls } = useThree();

  // Read via refs inside the native listeners so the effect (and its
  // listener attach/detach) doesn't need to re-run on every object edit.
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const centroidRef = useRef(centroidThree);
  centroidRef.current = centroidThree;

  useEffect(() => {
    const dom = gl.domElement;
    const anyControls = controls as unknown as { enabled: boolean } | null;

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.border = "1px solid #5be3ff";
    overlay.style.backgroundColor = "rgba(91, 227, 255, 0.12)";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "10";
    overlay.style.display = "none";

    let dragging = false;
    let startX = 0;
    let startY = 0;

    function positionOverlay(x0: number, y0: number, x1: number, y1: number) {
      overlay.style.left = `${Math.min(x0, x1)}px`;
      overlay.style.top = `${Math.min(y0, y1)}px`;
      overlay.style.width = `${Math.abs(x1 - x0)}px`;
      overlay.style.height = `${Math.abs(y1 - y0)}px`;
      overlay.style.display = "block";
    }

    function removeOverlay() {
      overlay.style.display = "none";
      overlay.parentElement?.removeChild(overlay);
    }

    function onPointerDown(e: PointerEvent) {
      if (!e.shiftKey || e.button !== 0) return;
      if (usePlaceModeStore.getState().armedType) return; // disabled while armed — see file header
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      if (anyControls) anyControls.enabled = false;
      dom.parentElement?.appendChild(overlay);
      positionOverlay(startX, startY, startX, startY);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      positionOverlay(startX, startY, e.clientX, e.clientY);
    }

    function onPointerUp(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      removeOverlay();
      if (anyControls) anyControls.enabled = true;

      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist <= DRAG_THRESHOLD_PX) return; // too small to be a marquee — treat as a click, do nothing here

      const rect = dom.getBoundingClientRect();
      const x0 = Math.min(startX, e.clientX) - rect.left;
      const x1 = Math.max(startX, e.clientX) - rect.left;
      const y0 = Math.min(startY, e.clientY) - rect.top;
      const y1 = Math.max(startY, e.clientY) - rect.top;

      const hits: string[] = [];
      const v = new THREE.Vector3();
      for (const o of objectsRef.current) {
        v.copy(ueVecToThree(o.position)).sub(centroidRef.current);
        v.project(camera);
        if (v.z < -1 || v.z > 1) continue; // behind camera / outside clip range
        const px = (v.x * 0.5 + 0.5) * rect.width;
        const py = (-v.y * 0.5 + 0.5) * rect.height;
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) hits.push(o.id);
      }
      if (hits.length === 0) return;

      const { selection, setSelection } = useEditorStore.getState();
      setSelection([...new Set([...selection, ...hits])]);
    }

    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      removeOverlay();
    };
  }, [camera, gl, controls]);

  return null;
}
