import * as THREE from 'three';

type Controls = {
  target: THREE.Vector3;
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener(type: 'start' | 'end', fn: () => void): void;
};

/** Where the orbit should be: pivot point, distance from it and height angle (radians). */
export interface OrbitPlan {
  pivot: THREE.Vector3;
  radius: number;
  elevation: number;
}

/**
 * Idle camera orbit: circles `plan()` until the user touches the view, then waits and
 * resumes at `resumeSpeed`. The camera never jumps: target, distance and height ease
 * towards the plan, so from any odd position it glides back onto the orbit.
 */
export function autoOrbit(
  controls: Controls,
  camera: THREE.Camera,
  plan: () => OrbitPlan | null,
  opts: { speed: number; resumeSpeed: number; idleMs?: number; onResume?: () => void },
): { readonly active: boolean; poke(): void } {
  let active = true;
  let timer = 0;
  let last = performance.now();
  controls.autoRotate = true;
  controls.autoRotateSpeed = opts.speed;
  const off = new THREE.Vector3();
  const sph = new THREE.Spherical();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const p = active ? plan() : null;
    if (p) {
      const k = 1 - Math.exp(-dt / 1.4);
      off.copy(camera.position).sub(controls.target);
      sph.setFromVector3(off);
      controls.target.lerp(p.pivot, k);
      sph.radius += (p.radius - sph.radius) * k;
      sph.phi += (Math.PI / 2 - p.elevation - sph.phi) * k;
      camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const pause = () => {
    active = false;
    controls.autoRotate = false;
    clearTimeout(timer);
  };
  const resumeLater = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      opts.onResume?.();
      active = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = opts.resumeSpeed;
    }, opts.idleMs ?? 6000);
  };
  controls.addEventListener('start', pause);
  controls.addEventListener('end', resumeLater);
  return {
    get active() {
      return active;
    },
    /** Other activity (editing): never stops a running orbit; while paused, restarts the idle wait. */
    poke() {
      if (!active) resumeLater();
    },
  };
}
