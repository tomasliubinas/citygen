import type * as THREE from 'three';

/** Camera position + orbit target as a compact URL value "x,y,z,tx,ty,tz" (decimetres). */
export function cameraToHash(camera: THREE.Camera, target: THREE.Vector3): string {
  const v = [camera.position.x, camera.position.y, camera.position.z, target.x, target.y, target.z];
  return v.map((n) => n.toFixed(1)).join(',');
}

export function cameraFromHash(value: string | null, camera: THREE.Camera, target: THREE.Vector3): boolean {
  if (!value) return false;
  const v = value.split(',').map(Number);
  if (v.length !== 6 || v.some((n) => !Number.isFinite(n))) return false;
  camera.position.set(v[0], v[1], v[2]);
  target.set(v[3], v[4], v[5]);
  return true;
}

/** Call `fn` after the camera has been still for a moment (OrbitControls/MapControls 'end'/'change'). */
export function onCameraSettled(controls: { addEventListener(t: 'change', f: () => void): void }, fn: () => void, ms = 400): void {
  let t = 0;
  controls.addEventListener('change', () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  });
}
