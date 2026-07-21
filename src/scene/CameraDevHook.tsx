// DEV-ONLY camera hook. Exposes the R3F camera + OrbitControls on window so an
// automated screenshot pipeline can set a deterministic, repeatable framing
// (identical before/after shots for feature GIFs). Guarded by import.meta.env
// .DEV at the call site in Scene.tsx, so it is tree-shaken out of production
// builds and never ships. Not wired to any UI.
import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useVisibilityStore } from "./visibilityStore";

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
}

export function CameraDevHook() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;

  useEffect(() => {
    const api = {
      camera,
      controls,
      // Point the camera at `target`, sitting `pos` away, and let OrbitControls
      // adopt that as its orbit target so subsequent drags behave.
      setView(pos: [number, number, number], target: [number, number, number]) {
        camera.position.set(pos[0], pos[1], pos[2]);
        if (controls) {
          controls.target.set(target[0], target[1], target[2]);
          controls.update();
        } else {
          camera.lookAt(target[0], target[1], target[2]);
        }
      },
      // Viewport-only level visibility (for peel/solo feature GIFs). Never
      // touches the model or export — same guarantee the eye toggles have.
      hideLevels(levels: number[]) {
        useVisibilityStore.setState({ hiddenLevels: new Set(levels) });
      },
      showAllLevels() {
        useVisibilityStore.getState().showAll();
      },
    };
    (window as unknown as { __mappalCam?: typeof api }).__mappalCam = api;
    return () => {
      delete (window as unknown as { __mappalCam?: typeof api }).__mappalCam;
    };
  }, [camera, controls]);

  return null;
}
