import { buildHouseMesh, generateHouse, MAX_ENVELOPE, MIN_ENVELOPE, STYLES, type HouseSpec, type StyleId, type WorldEdge } from '@citygen/house';
import { buildInteriorMesh, planInterior, type InteriorSpec } from '@citygen/interior';
import { PlanEditor, type Rect } from './editor';
import { cameraFromHash, cameraToHash, onCameraSettled } from './render/camera-hash';
import { HouseViewer } from './viewer';

interface State {
  rect: Rect;
  front: WorldEdge;
  seed: string;
  centrality: number;
  floors: number | null;
  style: StyleId;
  contract: boolean;
  apartments: 'auto' | 'single' | 'split';
  partyLeft: boolean;
  partyRight: boolean;
  time: 'day' | 'dusk' | 'night';
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const WORDS = ['linden', 'oak', 'amber', 'birch', 'heron', 'marble', 'willow', 'aster', 'cedar', 'rowan', 'juniper', 'elm', 'sorrel', 'lark', 'meadow', 'hazel'];

function readHash(): Partial<State> {
  const p = new URLSearchParams(location.hash.slice(1));
  const num = (k: string) => (p.has(k) ? Number(p.get(k)) : undefined);
  const out: Partial<State> = {};
  if (p.has('seed')) out.seed = p.get('seed')!;
  const [x0, z0, x1, z1] = ['x0', 'z0', 'x1', 'z1'].map(num);
  if ([x0, z0, x1, z1].every((v) => v !== undefined && Number.isFinite(v))) out.rect = { x0: x0!, z0: z0!, x1: x1!, z1: z1! };
  if (p.has('front')) out.front = p.get('front') as WorldEdge;
  if (p.has('c')) out.centrality = num('c');
  if (p.has('floors')) out.floors = num('floors') ?? null;
  if (p.get('style') && p.get('style')! in STYLES) out.style = p.get('style') as StyleId;
  if (p.get('interior') === '1') out.contract = true;
  if (p.get('pl') === '1') out.partyLeft = true;
  const tm = p.get('time');
  if (tm === 'day' || tm === 'dusk' || tm === 'night') out.time = tm;
  if (p.get('pr') === '1') out.partyRight = true;
  return out;
}

const state: State = {
  rect: { x0: -23, z0: -12, x1: 13, z1: 8 },
  front: 'south',
  seed: 'amber',
  centrality: 0.2,
  floors: null,
  style: 'french-classical',
  contract: false,
  apartments: 'auto',
  partyLeft: false,
  partyRight: false,
  time: 'day',
  ...readHash(),
};

const viewer = new HouseViewer($('viewport'));
const editor = new PlanEditor($<HTMLCanvasElement>('plan'), {
  extent: 80,
  minSize: MIN_ENVELOPE,
  maxSize: MAX_ENVELOPE - 20,
  onChange: (rect) => {
    state.rect = rect;
    schedule();
  },
  onFront: (front) => {
    state.front = front;
    sync();
    schedule();
  },
});
editor.setRect(state.rect);
editor.setFront(state.front);

const seedInput = $<HTMLInputElement>('seed');
const centrality = $<HTMLInputElement>('centrality');
const floors = $<HTMLSelectElement>('floors');
const contract = $<HTMLInputElement>('contract');
for (const [id, key] of [['pw-left', 'partyLeft'], ['pw-right', 'partyRight']] as const) {
  const el = $<HTMLInputElement>(id);
  el.checked = state[key];
  el.addEventListener('change', () => {
    state[key] = el.checked;
    schedule();
  });
}
const time = $<HTMLSelectElement>('time');
time.value = state.time;
time.addEventListener('change', () => {
  state.time = time.value as State['time'];
  viewer.setTime(state.time);
  schedule();
});
const style = $<HTMLSelectElement>('style');
// Styles come from the engine's registry, so new presets appear automatically.
style.replaceChildren(...Object.values(STYLES).map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
style.value = state.style;
style.addEventListener('change', () => {
  state.style = style.value as StyleId;
  schedule();
});

seedInput.value = state.seed;
centrality.value = String(state.centrality);
floors.value = state.floors == null ? 'auto' : String(state.floors);
contract.checked = state.contract;

seedInput.addEventListener('input', () => {
  state.seed = seedInput.value;
  schedule();
});
$('dice').addEventListener('click', () => {
  state.seed = `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
  seedInput.value = state.seed;
  schedule();
});
centrality.addEventListener('input', () => {
  state.centrality = Number(centrality.value);
  schedule();
});
floors.addEventListener('change', () => {
  state.floors = floors.value === 'auto' ? null : Number(floors.value);
  schedule();
});
contract.addEventListener('change', () => {
  state.contract = contract.checked;
  schedule();
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#front button')) {
  b.addEventListener('click', () => {
    state.front = b.dataset.v as WorldEdge;
    editor.setFront(state.front);
    sync();
    schedule();
  });
}
$('reset-view').addEventListener('click', () => viewer.frame());
const initialView = new URLSearchParams(location.hash.slice(1)).get('view');
// The default view: a chosen camera on the default house.
const DEFAULT_CAM = '31.9,9.6,33.5,-3.0,4.9,-0.7';
const hashAtLoad = new URLSearchParams(location.hash.slice(1));
const initialCam = hashAtLoad.get('cam') ?? (hashAtLoad.has('seed') ? null : DEFAULT_CAM);
let camRestored = false;
onCameraSettled(viewer.controls, () => writeCam());
function writeCam(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('cam', cameraToHash(viewer.camera, viewer.controls.target));
  history.replaceState(null, '', `#${p}`);
}

let current: HouseSpec | null = null;
$('download').addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `house-${current.input.seed || 'seed'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function sync(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#front button')) b.classList.toggle('on', b.dataset.v === state.front);
  $('centrality-v').textContent = state.centrality.toFixed(2);
  const { x0, z0, x1, z1 } = state.rect;
  $('dims').textContent = `${x1 - x0} × ${z1 - z0} m`;
}

let pending = 0;
function schedule(): void {
  sync();
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(regenerate);
}

function regenerate(): void {
  const { x0, z0, x1, z1 } = state.rect;
  const t0 = performance.now();
  const spec = generateHouse({
    seed: state.seed,
    envelope: { x: x0, z: z0, width: x1 - x0, depth: z1 - z0 },
    front: state.front,
    centrality: state.centrality,
    floors: state.floors,
    style: state.style,
    partyWalls: { left: state.partyLeft, right: state.partyRight },
  });
  const mesh = buildHouseMesh(spec);
  const interior = planInterior(spec, { apartments: state.apartments });
  const interiorMeshes = state.contract ? buildInteriorMesh(interior) : null;
  const ms = performance.now() - t0;
  current = spec;

  viewer.setSite(state.rect, state.front);
  viewer.setHouse(spec, mesh);
  if (interiorMeshes) viewer.setInterior(interior, interiorMeshes);
  viewer.setInteriorVisible(state.contract);
  editor.setOverlay(spec);

  const tris = Object.values(mesh).reduce((s, p) => s + p.indices.length / 3, 0);
  $('timing').textContent = `${ms.toFixed(0)} ms · ${(tris / 1000).toFixed(0)}k tris`;
  const list = $('features');
  if (state.contract) {
    renderRooms(interior);
  } else {
    list.replaceChildren(
      ...spec.features.map((f) => Object.assign(document.createElement('li'), { textContent: f })),
    );
  }
  const sw = document.createElement('li');
  sw.className = 'swatches';
  for (const k of ['wall', 'trim', 'roof', 'frame', 'door', 'stone'] as const) {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.title = k;
    s.style.background = spec.palette[k];
    sw.append(s);
  }
  list.append(sw);

  const p = new URLSearchParams({ seed: state.seed, x0: `${x0}`, z0: `${z0}`, x1: `${x1}`, z1: `${z1}`, front: state.front, c: state.centrality.toFixed(2), style: state.style });
  if (state.contract) p.set('interior', '1');
  if (state.partyLeft) p.set('pl', '1');
  if (state.time !== 'day') p.set('time', state.time);
  if (state.partyRight) p.set('pr', '1');
  if (state.floors != null) p.set('floors', String(state.floors));
  if (!camRestored && cameraFromHash(initialCam, viewer.camera, viewer.controls.target)) {
    viewer.controls.update();
    viewer.framed = true;
  } else if (initialView && !camRestored) viewer.frame(initialView);
  camRestored = true;
  p.set('cam', cameraToHash(viewer.camera, viewer.controls.target));
  history.replaceState(null, '', `#${p}`);
}

function renderRooms(interior: InteriorSpec): void {
  const list = $('features');
  const items: HTMLElement[] = [];
  const head = (t: string) => Object.assign(document.createElement('h3'), { textContent: t });
  const li = (t: string) => Object.assign(document.createElement('li'), { textContent: t });
  for (const L of [...interior.levels].reverse()) {
  const rooms = interior.rooms.filter((r) => r.level === L.index);
  items.push(head(`${L.name} · ${rooms.length} rooms · ${rooms.reduce((a, r) => a + r.area, 0).toFixed(0)} m²`));
  const groups = new Map<string, typeof rooms>();
  for (const r of rooms) groups.set(r.unit ?? '', [...(groups.get(r.unit ?? '') ?? []), r]);
  for (const [unit, rs] of groups) {
    const u = interior.units.find((x) => x.id === unit && x.level === L.index);
    if (u) items.push(head(`${u.name} · ${u.area} m²`));
    else if (groups.size > 1) items.push(head('Common'));
    for (const r of rs) items.push(li(`${r.name} — ${r.area.toFixed(1)} m²`));
  }
  }
  list.replaceChildren(...items);
}

viewer.setTime(state.time);
schedule();
