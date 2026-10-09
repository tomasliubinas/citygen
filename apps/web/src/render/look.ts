import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Shared "look" for every 3D page: physical sky + sky-lit environment, ambient
 * occlusion, AgX tone mapping, a soft vignette and grain, and a surface shader
 * that adds procedural plaster, dirt, brick, ashlar and roof tiles to the plain
 * engine materials (no textures, no UVs — everything from world position).
 */

export type SurfaceKind = 'none' | 'plaster' | 'trim' | 'stone' | 'roof' | 'ground';
const KIND: Record<SurfaceKind, number> = { none: 0, plaster: 1, trim: 2, stone: 3, roof: 4, ground: 5 };

const NOISE = /* glsl */ `
varying vec3 vLookPos;
varying vec3 vLookNormal;
uniform int uLookKind;
uniform float uLookAge;
float lookHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float lookHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lookNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lookHash3(i), lookHash3(i + vec3(1, 0, 0)), f.x), mix(lookHash3(i + vec3(0, 1, 0)), lookHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lookHash3(i + vec3(0, 0, 1)), lookHash3(i + vec3(1, 0, 1)), f.x), mix(lookHash3(i + vec3(0, 1, 1)), lookHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
/** 1 on grid lines near integers, anti-aliased by the screen-space footprint. */
float lookLine(float x, float halfWidth) {
  float d = min(fract(x), 1.0 - fract(x));
  float w = fwidth(x);
  return 1.0 - smoothstep(halfWidth - w, halfWidth + w, d);
}
/** 1 close up, 0 once a pattern cell gets smaller than about a pixel (avoids moiré). */
float lookFade(vec2 x) { vec2 w = fwidth(x); return clamp(1.6 - max(w.x, w.y) * 2.2, 0.0, 1.0); }
float lookFbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++) { s += a * lookNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const SURFACE = /* glsl */ `
{
  vec3 wp = vLookPos;
  vec3 wn = normalize(vLookNormal);
  // Along-the-face coordinate from the face's own horizontal direction (works on polygonal towers too).
  vec2 tng = length(wn.xz) > 1e-3 ? normalize(vec2(-wn.z, wn.x)) : vec2(1.0, 0.0);
  float along = dot(wp.xz, tng);
  vec3 c = diffuseColor.rgb;
  float h = wp.y;
  if (uLookKind == 1 || uLookKind == 2 || uLookKind == 3) {
    float brick = uLookKind == 1 ? smoothstep(0.08, 0.18, c.r - c.b) * step(c.g, 0.55) : 0.0;
    if (brick > 0.5 && abs(wn.y) < 0.5) {
      // Gothic brick: running bond, lighter mortar, uneven firing (anti-aliased, fades with distance).
      float v = h / 0.077;
      float row = floor(v);
      float u = along / 0.26 + mod(row, 2.0) * 0.5;
      // Bricks are tiny: fade the pattern out well before a brick shrinks to a few pixels.
      vec2 bw = fwidth(vec2(u, v));
      float fade = clamp(1.5 - max(bw.x, bw.y) * 5.0, 0.0, 1.0);
      float mortar = max(lookLine(u, 0.025), lookLine(v, 0.07)) * fade;
      float r = lookHash2(vec2(floor(u), row));
      c *= mix(1.0, 0.86 + 0.24 * r, fade);
      if (r > 0.94) c *= mix(1.0, 0.72, fade);
      // Mortar close to the brick tone: low contrast, so it never turns into moiré.
      c = mix(c, c * 0.72 + vec3(0.07, 0.065, 0.06), mortar * 0.6);
    } else if (uLookKind == 3 && abs(wn.y) < 0.5) {
      // Ashlar: coursed stone blocks with dark joints.
      float v = h / 0.36;
      float row = floor(v);
      float u = along / 0.74 + mod(row, 2.0) * 0.5;
      vec2 aw = fwidth(vec2(u, v));
      float fade = clamp(1.5 - max(aw.x, aw.y) * 6.0, 0.0, 1.0);
      float joint = max(lookLine(u, 0.012), lookLine(v, 0.025)) * fade;
      c *= mix(1.0, 0.93 + 0.12 * lookHash2(vec2(floor(u), row)), fade);
      c *= 1.0 - joint * 0.28;
    } else {
      // Plaster: broad tonal variation; old plaster yellows a little.
#ifndef LOOK_LITE
      c *= 0.955 + 0.09 * lookFbm(wp * 0.33);
      c = mix(c, c * vec3(0.975, 0.955, 0.9), uLookAge * 0.7);
#endif
    }
    if (brick > 0.5) c *= 1.0 - 0.08 * uLookAge;
    // Splash zone near the ground, rain streaks running down.
#ifndef LOOK_LITE
    float splash = (1.0 - smoothstep(0.0, 1.0 + 1.4 * uLookAge, h)) * (0.1 + 0.14 * lookFbm(wp * 1.3)) * (0.3 + 1.6 * uLookAge);
    float streak = smoothstep(0.58 - 0.12 * uLookAge, 0.9, lookFbm(vec3(along * 2.6, h * 0.22, 3.7)));
    c *= (1.0 - splash) * (1.0 - 0.08 * uLookAge * streak);
#else
    c *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 1.6, h));
#endif
#ifndef LOOK_LITE
    {
      // Wear on every wall material (plaster, ashlar, brick); trim weathers at half strength.
      float wear = smoothstep(0.0, 0.9, uLookAge) * (uLookKind == 2 ? 0.85 : 1.0);
      // Aged whites: stucco and trim drift to a dull ivory-grey (a multiply, never an overlay).
      float whiteness = smoothstep(0.7, 0.9, min(c.r, min(c.g, c.b)));
      c *= mix(vec3(1.0), vec3(0.86, 0.83, 0.76), wear * (0.35 + 0.65 * whiteness));
      // Faded paint: colour drains towards a warm grey.
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(lum) * vec3(0.97, 0.95, 0.9), 0.7 * wear);
      c *= 1.0 - 0.14 * wear;
      // Blotchy repaints: patches a shade lighter or darker.
      float blot = lookFbm(wp * 0.16 + 11.0);
      c *= 1.0 + wear * (smoothstep(0.58, 0.66, blot) * 0.06 - smoothstep(0.34, 0.26, blot) * 0.05);
      // Rising damp: a darker, uneven band above the ground.
      float damp = (1.0 - smoothstep(0.5, 1.2 + 0.5 * lookNoise(wp * 0.6), h)) * wear;
      c *= 1.0 - 0.4 * damp;
      // Peeling plaster: a few patches of bare grey render, mostly low on the wall.
      if ((uLookKind == 1 && brick < 0.5) || (uLookKind == 3 && h > 1.2)) {
        float pn = lookFbm(wp * 0.85 + 3.1) + 0.06 * (1.0 - smoothstep(0.8, 3.0, h));
        // More wear → lower threshold → more patches (monotonic); fades in from nothing.
        float peel = smoothstep(0.735, 0.745, pn + 0.13 * wear - 0.06) * smoothstep(0.05, 0.3, wear);
        // Plaster flakes off to grey render; stone erodes to a darker, rougher surface.
        vec3 under = uLookKind == 1 ? vec3(0.6, 0.57, 0.53) : c * vec3(0.78, 0.76, 0.72);
        c = mix(c, under * (0.9 + 0.2 * lookNoise(wp * 6.0)), peel * 0.85);
      }
    }
#endif

  } else if (uLookKind == 4) {
    // Roof: staggered slates / tiles in rows, each a slightly different tone.
    float v = h / 0.115;
    float row = floor(v);
    float u = along / 0.32 + mod(row, 2.0) * 0.5;
    vec2 tw = fwidth(vec2(u, v));
    float fade = clamp(1.5 - max(tw.x, tw.y) * 5.0, 0.0, 1.0);
    float r = lookHash2(vec2(floor(u), row));
    c *= mix(1.0, 0.86 + 0.2 * r, fade);
    c *= mix(1.0, 0.8 + 0.2 * smoothstep(0.0, 0.3, fract(v)), fade);
    c *= 1.0 - 0.18 * lookLine(u, 0.02) * fade;
#ifndef LOOK_LITE
    // Roof wear (cheap: one hash + one stretched noise), always multiplied onto the clean tiles.
    float rwear = smoothstep(0.35, 1.0, uLookAge);
    // Individual tiles: some darker / weathered, a few replaced in a fresher tone.
    float r2 = lookHash2(vec2(floor(u) + 17.0, row));
    c *= mix(1.0, 0.82 + 0.18 * r2, rwear * fade);
    c *= mix(1.0, 1.1, step(0.96, r2) * rwear * fade);
    // Rain washes straight down the slope: thin vertical runs, darker towards the eaves.
    float run = lookNoise(vec3(along * 2.2, h * 0.08, 7.0));
    c *= 1.0 - rwear * 0.22 * smoothstep(0.45, 0.85, run);
    // Moss sits in the lower lap of each tile, greener where water runs.
    float lap = 1.0 - smoothstep(0.0, 0.35, fract(v));
    c *= mix(vec3(1.0), vec3(0.9, 1.04, 0.82), rwear * lap * (0.4 + 0.6 * run) * fade);
    // Dark slate cannot be darkened: there wear shows as a lift (dust, lime bloom, grey-green
    // lichen), per tile and along the runs, weighted by how dark the surface is.
    float dark = 1.0 - smoothstep(0.08, 0.35, dot(c, vec3(0.3, 0.59, 0.11)));
    vec3 bloom = vec3(0.075, 0.08, 0.065) * (0.35 + 0.65 * r2) + vec3(0.02, 0.035, 0.0) * lap;
    c += dark * rwear * bloom * (0.55 + 0.45 * smoothstep(0.35, 0.8, run)) * mix(1.0, 0.7, 1.0 - fade);
#endif
  } else if (uLookKind == 5) {
#ifndef LOOK_LITE
    c *= 0.82 + 0.3 * lookFbm(wp * 0.045) + 0.06 * (lookNoise(wp * 1.7) - 0.5);
#else
    c *= 0.88 + 0.22 * lookNoise(wp * 0.03);
#endif
  }
  diffuseColor.rgb = c;
}
`;

const BUMP = /* glsl */ `
#ifndef LOOK_LITE
float lookBrick = smoothstep(0.08, 0.18, diffuseColor.r - diffuseColor.b) * step(diffuseColor.g, 0.55);
if ((uLookKind == 1 || uLookKind == 2) && lookBrick < 0.5) {
  // Uneven plaster: perturb the normal with low-amplitude, low-frequency noise (tangent part only).
  vec3 wn = normalize(vLookNormal);
  vec3 b = vec3(lookNoise(vLookPos * 1.3), lookNoise(vLookPos * 1.3 + 17.3), lookNoise(vLookPos * 1.3 + 41.7)) - 0.5;
  b -= dot(b, wn) * wn;
  normal = normalize(normal + (viewMatrix * vec4(b * 0.08, 0.0)).xyz);
}
#endif
`;

/** Add the procedural surface layer to a standard material (idempotent). */
/** `lite`: only the cheap line patterns (brick, tiles, joints) — no per-pixel noise layers. */
export function enhanceMaterial(mat: THREE.MeshStandardMaterial, kind: SurfaceKind, lite = false): THREE.MeshStandardMaterial {
  if (kind === 'none' || mat.userData.lookKind === kind) return mat;
  mat.userData.lookKind = kind;
  if (lite) mat.defines = { ...(mat.defines ?? {}), LOOK_LITE: '' };
  mat.userData.age = mat.userData.age ?? { value: 0.35 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLookKind = { value: KIND[kind] };
    shader.uniforms.uLookAge = mat.userData.age;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLookPos;\nvarying vec3 vLookNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvLookNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLookPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${BUMP}`);
  };
  mat.customProgramCacheKey = () => `look-${kind}${lite ? '-lite' : ''}`;
  mat.needsUpdate = true;
  return mat;
}

/** Surface kind for an engine material slot. */
export function kindForSlot(slot: string): SurfaceKind {
  if (slot === 'wall') return 'plaster';
  if (slot === 'trim' || slot === 'accent') return 'trim';
  if (slot === 'stone') return 'stone';
  if (slot === 'roof') return 'roof';
  return 'none';
}

const FINISH = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.95, 0.3, length(vUv - 0.5));
      c.rgb *= mix(0.84, 1.0, v);
      float g = fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.02;
      gl_FragColor = c;
    }`,
};

/** Gradient sky dome with a soft sun glow (controllable, unlike a physical sky). */
function makeSky(radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#7398c2') },
      uHorizon: { value: new THREE.Color('#dbe5ec') },
      uGround: { value: new THREE.Color('#b7b3a6') },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = clamp(d.y, -1.0, 1.0);
        vec3 c = t > 0.0 ? mix(uHorizon, uZenith, pow(t, 0.55)) : mix(uHorizon, uGround, pow(-t, 0.4));
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += vec3(1.0, 0.86, 0.66) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

export interface Look {
  sky: THREE.Mesh;
  /** Switch sky, environment, fog, exposure and window lights; the caller applies sun/hemisphere values. */
  setTime(t: TimeOfDay): TimePreset;
  setSize(w: number, h: number): void;
  render(): void;
  /** Direction towards the sun (world). */
  setSun(dir: THREE.Vector3): void;
}

export function createLook(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts: { aoRadius: number; haze: number; skyRadius: number },
): Look {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const sky = makeSky(opts.skyRadius);
  scene.add(sky);
  scene.background = null;
  if (opts.haze > 0) scene.fog = new THREE.FogExp2('#cdd8e2', opts.haze);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSky(50);
  envScene.add(envSky);
  let envRT: THREE.WebGLRenderTarget | null = null;
  let envIntensity = 0.5;

  // Multisampled HDR target: keeps edges smooth now that rendering goes through post-processing.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: opts.aoRadius, distanceExponent: 1.2, thickness: 1.5, scale: 1.0, samples: 12 });
  ao.blendIntensity = 0.85;
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(FINISH));

  return {
    sky,
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    render() {
      composer.render();
    },
    setTime(t) {
      const p = TIMES[t];
      for (const m of [sky.material, envSky.material]) {
        m.uniforms.uZenith.value.set(p.zenith);
        m.uniforms.uHorizon.value.set(p.horizon);
        m.uniforms.uGround.value.set(p.ground);
      }
      if (scene.fog) (scene.fog as THREE.FogExp2).color.set(p.fog);
      renderer.toneMappingExposure = p.exposure;
      envIntensity = p.env;
      lookGlobals.night.value = p.night;
      this.setSun(sky.material.uniforms.uSun.value.clone());
      return p;
    },
    setSun(dir) {
      const d = dir.clone().normalize();
      sky.material.uniforms.uSun.value.copy(d);
      envSky.material.uniforms.uSun.value.copy(d);
      envRT?.dispose();
      envRT = pmrem.fromScene(envScene, 0, 0.1, 200);
      scene.environment = envRT.texture;
      scene.environmentIntensity = envIntensity;
    },
  };
}

/** Set a house's wear on all of its enhanced materials. */
export function setAge(mats: Iterable<THREE.Material>, age: number): void {
  for (const m of mats) if (m.userData.age) m.userData.age.value = age;
}

/**
 * Geometry for a MeshBuffers part. The per-vertex scalar means opacity for
 * 'stain' decals (→ RGBA colour) and a per-window random id for 'glass' (→ aWin).
 */
export function geometryFor(buf: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; alpha?: Float32Array }, slot = ''): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3));
  g.setIndex(new THREE.BufferAttribute(buf.indices, 1));
  if (slot === 'glass') {
    g.setAttribute('aWin', new THREE.BufferAttribute(buf.alpha ?? new Float32Array(buf.positions.length / 3).fill(0.5), 1));
  } else if (buf.alpha && (slot === 'stain' || slot === 'rust')) {
    const col = new Float32Array((buf.alpha.length) * 4);
    for (let i = 0; i < buf.alpha.length; i++) col.set([1, 1, 1, buf.alpha[i]], i * 4);
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  return g;
}

/** Darkening overlay for stain decals (vertex alpha). */
export function stainMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 1, transparent: true, vertexColors: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/** Scene-wide state shared by every glass material (time of day). */
export const lookGlobals = { night: { value: 0 }, lit: { value: 0.45 } };

/**
 * Glass gets its own studio-style reflection map (bright light panels) so panes
 * show crisp highlights; the soft sky alone makes reflections look flat.
 */
let studioEnv: THREE.Texture | null = null;
export function glassReflections(renderer: THREE.WebGLRenderer, glass: THREE.MeshStandardMaterial): void {
  studioEnv ??= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.02).texture;
  glass.envMap = studioEnv;
  glass.needsUpdate = true;
}

/**
 * Window glass: dielectric with Fresnel reflections of the sky; each pane (aWin)
 * gets its own interior darkness and sometimes a curtain; at dusk/night a share
 * of the windows glows warm through the curtains.
 */
export function glassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.05, metalness: 0.15, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = lookGlobals.night;
    shader.uniforms.uLit = lookGlobals.lit;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWin;\nvarying float vWin;\nvarying vec3 vGlassPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvGlassPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWin;\nvarying vec3 vGlassPos;\nuniform float uNight;\nuniform float uLit;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // vWin = pane random fraction + house wear bucket (0…10).
        float wr = fract(vWin);
        float wwear = clamp(floor(vWin + 0.001) / 10.0, 0.0, 1.0);
        float wr2 = fract(wr * 7.13 + 0.31);
        vec3 inside = diffuseColor.rgb * (0.55 + 0.7 * wr2);
        // Kept houses: few curtains, all one light linen. Worn houses: more of them, mixed colours.
        float curtain = step(1.0 - (0.18 + 0.5 * wwear), fract(wr * 3.7));
        float pick = floor(fract(wr * 13.1) * 5.0);
        // Ivories and faded, muted tones only (no reds/pinks).
        // Ivories plus a few colours, toned halfway down towards linen (subtle, not loud).
        vec3 tone = pick < 1.0 ? vec3(0.62, 0.36, 0.3) : pick < 2.0 ? vec3(0.4, 0.5, 0.36) : pick < 3.0 ? vec3(0.86, 0.76, 0.5) : pick < 4.0 ? vec3(0.42, 0.48, 0.6) : vec3(0.9, 0.86, 0.76);
        vec3 mixed = mix(vec3(0.84, 0.79, 0.68), tone, 0.5);
        vec3 cloth = mix(vec3(0.84, 0.79, 0.68), mixed, step(0.35, wwear * fract(wr * 5.9) * 2.0));
        // Seen through glass from outside, curtains read dim: barely visible on kept houses.
        inside = mix(inside, cloth * (0.3 + 0.25 * wwear), curtain * (0.3 + 0.35 * wwear));
        // Roller blinds at random heights on worn houses.
        float blindOn = step(1.0 - 0.35 * wwear, fract(wr * 9.7));
        float blindY = fract(vGlassPos.y / 3.9 + wr) ;
        // Soft blind edge and low contrast: no hard horizontal band.
        inside = mix(inside, vec3(0.72, 0.68, 0.6) * (0.35 + 0.15 * wwear), blindOn * 0.6 * smoothstep(0.3 + 0.5 * wr2, 0.45 + 0.5 * wr2, blindY));
        // Dust film and, on derelict houses, the odd boarded-up pane.
        inside = mix(inside, vec3(0.42, 0.41, 0.38), 0.3 * wwear);
        float boarded = step(1.0 - 0.06 * wwear * wwear, fract(wr * 21.7));
        inside = mix(inside, vec3(0.3, 0.22, 0.15), boarded);
        curtain = max(curtain, boarded);
        diffuseColor.rgb = inside;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Fake reflection: sky → horizon → ground by the reflected view ray, Fresnel-weighted.
        vec3 vdir = normalize(vViewPosition);
        vec3 rv = inverseTransformDirection(reflect(-vdir, normal), viewMatrix);
        float fres = 0.18 + 0.82 * pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 4.0);
        vec3 skyR = rv.y > 0.0 ? mix(vec3(0.82, 0.86, 0.9), vec3(0.42, 0.55, 0.72), pow(rv.y, 0.6)) : mix(vec3(0.6, 0.6, 0.58), vec3(0.18, 0.18, 0.17), pow(-rv.y, 0.5));
        // Within the pane: brighter towards the top (sky).
        float hgt = vGlassPos.y;
        float top = smoothstep(-0.6, 0.9, fract(hgt / 3.8 + 0.15) - 0.5);
        vec3 refl = skyR * fres * (0.55 + 0.12 * top);
        totalEmissiveRadiance += refl * (1.0 - curtain * 0.5) * (1.0 - uNight) * (1.0 - 0.45 * wwear);
        float wlit = step(wr, uLit) * uNight * (1.0 - boarded);
        vec3 lamp = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.78, 0.5), wr2);
        totalEmissiveRadiance += lamp * wlit * (0.38 + 0.42 * wr2) * mix(1.0, 0.8, curtain);`);
  };
  mat.customProgramCacheKey = () => 'look-glass';
  return mat;
}

export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface TimePreset {
  zenith: string; horizon: string; ground: string; fog: string;
  sunColor: string; sunIntensity: number; hemiIntensity: number;
  /** Multiplier on the sun's height (low sun at dusk). */
  sunElevation: number;
  exposure: number; env: number; night: number;
}

export const TIMES: Record<TimeOfDay, TimePreset> = {
  // Late-afternoon day: lower, warmer sun and longer shadows, a step towards dusk.
  day: { zenith: '#6b8fbd', horizon: '#e6dccb', ground: '#aea898', fog: '#d4d3cc', sunColor: '#ffe2bd', sunIntensity: 2.9, hemiIntensity: 0.4, sunElevation: 0.55, exposure: 0.92, env: 0.45, night: 0 },
  dusk: { zenith: '#34466e', horizon: '#eea36a', ground: '#5f5650', fog: '#b98d77', sunColor: '#ffa45e', sunIntensity: 2.0, hemiIntensity: 0.3, sunElevation: 0.22, exposure: 1.05, env: 0.35, night: 0.7 },
  night: { zenith: '#070d1c', horizon: '#1d2740', ground: '#16171b', fog: '#1a2235', sunColor: '#a8bcff', sunIntensity: 0.25, hemiIntensity: 0.08, sunElevation: 0.9, exposure: 1.15, env: 0.12, night: 1 },
};
