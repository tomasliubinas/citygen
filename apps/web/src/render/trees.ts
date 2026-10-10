import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Leafy bush geometry (set up by treeVariants). */
export let bushGeometry: (r: number) => THREE.BufferGeometry = () => new THREE.BufferGeometry();

const GREENS = ['#4f6a3e', '#5a7444', '#46603a', '#617c4a'].map((c) => new THREE.Color(c));

/**
 * A few tree variants for instancing: trunk with two limbs, crown of overlapping leafy lobes in
 * mixed greens (vertex colours), each about 7–8 m tall at scale 1. Built once, reused by every tree.
 */
export function treeVariants(count = 3): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry }[] {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  /**
   * Leafy lobe: the facets of an icosahedron, each shrunk/grown, tilted and pushed out a random
   * amount along its normal, so the crown is an open cluster of leaf facets with gaps — not a blob.
   */
  const blob = (r: number, color: THREE.Color) => {
    // Detail 1 (80 facets per lobe): scattered and leafy, cheap enough for a whole city.
    const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    const pos = g.getAttribute('position');
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.add(p.fromBufferAttribute(pos, t + k));
      c.multiplyScalar(1 / 3);
      const push = 1 + (rnd() - 0.25) * 0.45;
      const size = 0.75 + rnd() * 0.75;
      const jig = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(r * 0.25);
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(pos, t + k).sub(c).multiplyScalar(size).add(c.clone().multiplyScalar(push)).add(jig);
        pos.setXYZ(t + k, p.x, p.y * 0.92, p.z);
      }
    }
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const shade = 0.85 + rnd() * 0.3;
      for (let k = 0; k < 3; k++) col.set([color.r * shade, color.g * shade, color.b * shade], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    return g;
  };
  /** Low bush: a single leafy lobe. */
  bushGeometry = (r: number) => blob(r, GREENS[Math.floor(rnd() * 4)]);
  return Array.from({ length: count }, (_, v) => {
    const th = 3.2;
    const lobes: THREE.BufferGeometry[] = [];
    const n = 5 + v;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd();
      const g = blob(1.3 + rnd() * 0.6, GREENS[(k + v) % 4]);
      g.translate(Math.cos(a) * 1.1, th + 0.9 + rnd() * 1.4, Math.sin(a) * 1.1);
      lobes.push(g);
    }
    const top = blob(1.5, GREENS[(v + 1) % 4]);
    top.translate(0, th + 2.4, 0);
    lobes.push(top);
    const trunkParts = [new THREE.CylinderGeometry(0.14, 0.26, th, 7).translate(0, th / 2, 0)];
    for (const sgn of [-1, 1]) {
      const limb = new THREE.CylinderGeometry(0.06, 0.1, 1.6, 5).rotateZ(-sgn * 0.7).translate(sgn * 0.45, th * 0.85, 0);
      trunkParts.push(limb);
    }
    for (const p of trunkParts) p.deleteAttribute('uv');
    return { crown: mergeGeometries(lobes)!, trunk: mergeGeometries(trunkParts)! };
  });
}
