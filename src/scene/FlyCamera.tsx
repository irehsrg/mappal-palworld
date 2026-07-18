// Unity-SceneView-style RMB flythrough camera. Built for mega-bases
// (thousands of pieces, CLAUDE.md §6's donor pattern): OrbitControls orbits
// around a fixed target, so dollying "in" always dollies TOWARD that target —
// it can never get the camera past a wall and into an interior. A free fly
// camera that ignores geometry (clips as needed, per the task brief) is the
// only way to get inside a dense tower's cladding to place interior walls.
//
// Interaction model (exactly Unity's Scene View):
//   - Hold RMB on the canvas -> flythrough mode while held. Mouse moves =
//     look (yaw/pitch). WASD = move relative to the camera's OWN look
//     direction (forward/right, including pitch). Q/E = move along the
//     WORLD vertical axis (task brief — deliberately NOT camera-local up, so
//     Q/E always means "down/up" even while pitched). Shift = 3x speed.
//   - Scroll while RMB held = adjust fly speed multiplicatively (persisted
//     across the session in speedRef, not reset per-hold) — shown briefly in
//     a small DOM overlay (.fly-speed-hint, src/index.css).
//   - Release RMB -> OrbitControls re-enabled, its target snapped to
//     "a few metres in front of wherever flight left the camera" so orbit
//     resumes from the same view instead of snapping back to a stale target
//     or flipping.
//
// While flying: OrbitControls is fully disabled (enabled=false) and the
// canvas's native context menu is suppressed so RMB never pops the browser
// menu. useKeyboardControls.ts (outside this component's tree — see
// flyCameraState.ts) checks the shared isFlying flag and ignores WASD/Q/E
// itself while flying, so flight input always wins over the rotate-selection
// Q/E binding without either file needing to know the other's internals.
//
// Movement/look are computed in useFrame (frame-rate independent, delta-
// scaled), NOT inside the DOM listeners — the listeners only ever update
// held-key state / accumulated yaw-pitch, exactly like the rest of this
// codebase keeps native-DOM listeners cheap and defers actual scene math to
// React Three Fiber's render loop.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { flyCameraState } from "./flyCameraState";

/** deg/px -> rad/px (task brief: ~0.15deg/px). */
const LOOK_SENSITIVITY = (0.15 * Math.PI) / 180;
const PITCH_LIMIT = (89 * Math.PI) / 180;
/** metres/second — three.js units are metres, see coords.ts's UNIT_SCALE. */
const BASE_SPEED = 6;
const SHIFT_MULTIPLIER = 3;
/** How far in front of the camera OrbitControls' target lands on release (task brief: "a few units, e.g. 8"). */
const ORBIT_RESUME_DISTANCE = 8;
const SPEED_HINT_MS = 1200;
const SPEED_MIN = 0.5;
const SPEED_MAX = 200;
const SPEED_SCROLL_FACTOR = 1.15;

type OrbitControlsLike = { enabled: boolean; target: THREE.Vector3; update: () => void };

export function FlyCamera() {
  const { camera, gl, controls } = useThree();

  const flyingRef = useRef(false);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const heldKeysRef = useRef<Set<string>>(new Set());
  const speedRef = useRef(BASE_SPEED);
  const hintTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const dom = gl.domElement;
    const anyControls = controls as unknown as OrbitControlsLike | null;

    // Small "fly speed: N.N m/s" hint (task brief) — same imperative,
    // directly-mutated DOM overlay technique as MarqueeSelect.tsx's drag
    // rectangle, so a burst of wheel events never forces a React render.
    const hint = document.createElement("div");
    hint.className = "fly-speed-hint";
    hint.style.display = "none";

    function showSpeedHint() {
      hint.textContent = `fly speed: ${speedRef.current.toFixed(1)} m/s`;
      hint.style.display = "block";
      if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = window.setTimeout(() => {
        hint.style.display = "none";
      }, SPEED_HINT_MS);
    }

    function startFlying() {
      if (flyingRef.current) return;
      flyingRef.current = true;
      flyCameraState.isFlying = true;
      heldKeysRef.current.clear();

      // Seed yaw/pitch from the camera's CURRENT orientation (wherever
      // OrbitControls last left it) so the first frame of flight doesn't
      // snap the view — mirror of the target-placement on release below.
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      yawRef.current = euler.y;
      pitchRef.current = euler.x;

      // Disabling here (rather than waiting on some later effect) matters
      // for the SAME reason as MarqueeSelect.tsx's identical trick: three's
      // OrbitControls only ever checks `enabled` inside its OWN pointermove
      // handler, not at pointerdown, so it doesn't matter whether our
      // pointerdown listener races ahead of OrbitControls' internal one —
      // by the first pointermove `enabled` is already false and no pan/
      // rotate/dolly can start.
      if (anyControls) anyControls.enabled = false;

      dom.parentElement?.appendChild(hint);
    }

    function stopFlying() {
      if (!flyingRef.current) return;
      flyingRef.current = false;
      flyCameraState.isFlying = false;
      heldKeysRef.current.clear();

      // Seamless return to orbit (task brief): park OrbitControls' target a
      // few metres ahead of the camera's forward vector so orbiting resumes
      // from this exact view — not the stale (often origin) target it had
      // before flight started, which would otherwise snap/flip the camera
      // the instant the user drags to orbit again.
      if (anyControls) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        anyControls.target.copy(camera.position).addScaledVector(forward, ORBIT_RESUME_DISTANCE);
        anyControls.enabled = true;
        anyControls.update();
      }

      if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
      hint.style.display = "none";
      hint.parentElement?.removeChild(hint);
    }

    function onContextMenu(e: MouseEvent) {
      // Always suppressed on the canvas (task brief) — a right-click here
      // only ever means "fly", never "open browser menu".
      e.preventDefault();
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 2) return;
      e.preventDefault();
      startFlying();
    }

    function onPointerMove(e: PointerEvent) {
      if (!flyingRef.current) return;
      yawRef.current -= e.movementX * LOOK_SENSITIVITY;
      pitchRef.current -= e.movementY * LOOK_SENSITIVITY;
      pitchRef.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchRef.current));
    }

    function onPointerUp(e: PointerEvent) {
      if (e.button !== 2) return;
      stopFlying();
    }

    function onWheel(e: WheelEvent) {
      if (!flyingRef.current) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? SPEED_SCROLL_FACTOR : 1 / SPEED_SCROLL_FACTOR;
      speedRef.current = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speedRef.current * factor));
      showSpeedHint();
    }

    // WASD/Q/E/Shift held-state, tracked only while flying — this is the
    // ONLY place these keys are read; useKeyboardControls.ts (a separate
    // window-level listener outside this component's tree) explicitly
    // ignores them while flyCameraState.isFlying is true, so there's no
    // double-handling.
    function onKeyDown(e: KeyboardEvent) {
      if (!flyingRef.current) return;
      const k = e.key.toLowerCase();
      if (k === "w" || k === "a" || k === "s" || k === "d" || k === "q" || k === "e" || k === "shift") {
        heldKeysRef.current.add(k);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      heldKeysRef.current.delete(e.key.toLowerCase());
    }

    // A lost window (alt-tab, devtools focus-steal, etc.) mid-hold must not
    // leave flight stuck on with a phantom-held RMB and no way to release it
    // — same class of guard MarqueeSelect.tsx relies on window-level
    // pointerup for.
    function onBlur() {
      stopFlying();
    }

    dom.addEventListener("contextmenu", onContextMenu);
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      dom.removeEventListener("contextmenu", onContextMenu);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (hintTimeoutRef.current !== null) window.clearTimeout(hintTimeoutRef.current);
      hint.parentElement?.removeChild(hint);
      flyCameraState.isFlying = false;
    };
    // controls comes from drei's makeDefault registration, which can arrive
    // after this component's first mount — re-attaching when it changes
    // (from null to the real instance) picks up the real enable/target/
    // update methods instead of staying bound to a stale null forever. Same
    // pattern as MarqueeSelect.tsx's identical effect dependency list.
  }, [camera, controls, gl]);

  // Continuous per-frame look + movement (task brief: "frame-rate
  // independent, delta-scaled"). Orientation is written here (not in the
  // pointermove listener above) so it updates at render rate regardless of
  // how often pointermove events arrive.
  useFrame((_state, delta) => {
    if (!flyingRef.current) return;

    camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, "YXZ"));

    const held = heldKeysRef.current;
    const speed = speedRef.current * (held.has("shift") ? SHIFT_MULTIPLIER : 1) * delta;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    if (held.has("w")) camera.position.addScaledVector(forward, speed);
    if (held.has("s")) camera.position.addScaledVector(forward, -speed);
    if (held.has("d")) camera.position.addScaledVector(right, speed);
    if (held.has("a")) camera.position.addScaledVector(right, -speed);
    // World vertical axis (task brief), not camera-local up — Q/E always
    // means straight down/up even while pitched.
    if (held.has("e")) camera.position.y += speed;
    if (held.has("q")) camera.position.y -= speed;
  });

  return null;
}
