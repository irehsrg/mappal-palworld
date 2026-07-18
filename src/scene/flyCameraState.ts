// Shared flag: true while the RMB flythrough camera (FlyCamera.tsx) is
// actively flying. FlyCamera.tsx lives inside the <Canvas>/R3F tree;
// useKeyboardControls.ts is a plain window-level hook rendered outside it
// (App.tsx) — there's no React context that spans both, and this only needs
// to be READ synchronously inside a native keydown handler, never subscribed
// to or rendered from, so a zustand store (or any reactive store) would be
// pure overhead. A single mutable object, same spirit as a ref.
export const flyCameraState = { isFlying: false };
