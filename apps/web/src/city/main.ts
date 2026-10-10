import { generateCity, type CityPattern, type PlotSpec } from '@citygen/city';
import { STYLES, type HouseSpec } from '@citygen/house';
import { Minimap } from './minimap';
import { CityView } from './view';
import { addMoreCue } from '../render/more';

interface State {
  seed: string;
  size: number;
  pattern: CityPattern;
  block: number;
  falloff: number;
  detail: number;
  time: 'day' | 'dusk' | 'night';
  styles: Record<string, boolean>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORDS = ['vilnius', 'trakai', 'kaunas', 'riga', 'krakow', 'lviv', 'gdansk', 'tartu', 'brno', 'graz', 'linz', 'turku'];
const styleIds = Object.keys(STYLES);

function readHash(): Partial<State> {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: Partial<State> = {};
  if (p.has('seed')) out.seed = p.get('seed')!;
  if (p.has('size')) out.size = Math.min(1000, Math.max(500, Number(p.get('size'))));
  const pat = p.get('pattern');
  if (pat === 'radial' || pat === 'organic') out.pattern = pat;
  if (p.has('block')) out.block = Math.min(1.6, Math.max(1.2, Number(p.get('block'))));
  if (p.has('detail')) out.detail = Number(p.get('detail'));
  const tm = p.get('time');
  if (tm === 'day' || tm === 'dusk' || tm === 'night') out.time = tm;
  if (p.has('styles')) {
    const on = new Set(p.get('styles')!.split(','));
    out.styles = Object.fromEntries(styleIds.map((k) => [k, on.has(k)]));
  }
  return out;
}

const state: State = {
  seed: 'amber',
  size: 600,
  pattern: 'organic',
  block: 1.35,
  // Fixed: how quickly the city thins out from the centre.
  falloff: 1.5,
  detail: 30,
  time: 'dusk',
  styles: Object.fromEntries(styleIds.map((k) => [k, true])),
  ...readHash(),
};

const view = new CityView($('viewport'));
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), (x, z) => view.flyTo(x, z));
let selected: number | null = null;

// ---- Controls ---------------------------------------------------------------------------
const seed = $<HTMLInputElement>('seed');
const pattern = $<HTMLSelectElement>('pattern');
const size = $<HTMLInputElement>('size');
const block = $<HTMLInputElement>('block');
const detail = $<HTMLInputElement>('detail');
seed.value = state.seed;
pattern.value = state.pattern;
size.value = String(state.size);
block.value = String(state.block);
detail.value = String(state.detail);
const time = $<HTMLSelectElement>('time');
time.value = state.time;
time.addEventListener('change', () => { state.time = time.value as State['time']; view.setTime(state.time); writeHash(); });

const stylesBox = $('styles');
for (const k of styleIds) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.styles[k] !== false;
  cb.addEventListener('change', () => {
    state.styles[k] = cb.checked;
    schedule();
  });
  const count = document.createElement('span');
  count.className = 'count';
  count.dataset.style = k;
  label.append(cb, document.createTextNode(STYLES[k as keyof typeof STYLES].label), count);
  stylesBox.append(label);
}

seed.addEventListener('input', () => { state.seed = seed.value; schedule(); });
$('dice').addEventListener('click', () => {
  state.seed = `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
  seed.value = state.seed;
  schedule();
});
pattern.addEventListener('change', () => { state.pattern = pattern.value as CityPattern; schedule(); });
for (const [el, key] of [[size, 'size'], [block, 'block']] as const) {
  el.addEventListener('input', () => { (state[key] as number) = Number(el.value); labels(); schedule(400); });
}
detail.addEventListener('input', () => { state.detail = Number(detail.value); view.detailCount = state.detail; labels(); writeHash(); });
$('top').addEventListener('click', () => view.topView());
$('home').addEventListener('click', () => view.home());
$('regen').addEventListener('click', () => regenerate(true));

function labels(): void {
  $('size-v').textContent = `${state.size} m`;
  $('block-v').textContent = `×${state.block.toFixed(2)}`;
  $('detail-v').textContent = String(state.detail);
}

import { cameraFromHash, cameraToHash, onCameraSettled } from '../render/camera-hash';
// The default view: a chosen spot in the default city (seed amber).
const DEFAULT_CAM = '8.1,51.0,-113.8,61.6,6.0,-36.8';
const hashParams = new URLSearchParams(location.hash.slice(1));
const initialCam = hashParams.get('cam') ?? (hashParams.has('seed') ? null : DEFAULT_CAM);
onCameraSettled(view.controls, () => writeHash());

function writeHash(): void {
  const on = styleIds.filter((k) => state.styles[k] !== false);
  const p = new URLSearchParams({
    seed: state.seed, size: String(state.size), pattern: state.pattern, block: String(state.block),
    detail: String(state.detail), styles: on.join(','), time: state.time,
    cam: cameraToHash(view.camera, view.controls.target),
  });
  history.replaceState(null, '', `#${p}`);
}

let timer = 0;
function schedule(delay = 150): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => regenerate(false), delay);
}

let first = true;
function regenerate(resetView: boolean): void {
  const on = styleIds.filter((k) => state.styles[k] !== false);
  const t0 = performance.now();
  const city = generateCity({
    seed: state.seed,
    size: state.size,
    pattern: state.pattern,
    blockScale: state.block,
    falloff: state.falloff,
    styles: Object.fromEntries((on.length ? on : styleIds).map((k) => [k, 1])),
  });
  const ms = performance.now() - t0;
  view.detailCount = state.detail;
  view.setTime(state.time);
  view.setCity(city);
  minimap.setCity(city);
  selected = null;
  if (first && cameraFromHash(initialCam, view.camera, view.controls.target)) view.controls.update();
  else if (first || resetView) view.home();
  first = false;

  const counts = new Map<string, number>();
  for (const p of city.plots) counts.set(p.style, (counts.get(p.style) ?? 0) + 1);
  for (const el of document.querySelectorAll<HTMLElement>('.styles .count')) el.textContent = String(counts.get(el.dataset.style!) ?? 0);
  const built = city.blocks.filter((b) => b.kind === 'built').length;
  const parks = city.blocks.filter((b) => b.kind === 'park').length;
  const plazas = city.blocks.filter((b) => b.kind === 'plaza').length;
  const li = (t: string) => Object.assign(document.createElement('li'), { textContent: t });
  $('stats').replaceChildren(
    li(`${city.size} × ${city.size} m, ${state.pattern} pattern (layout ${ms.toFixed(0)} ms)`),
    li(`${city.streets.filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1).length} street segments`),
    li(`${built} built blocks · ${parks} parks · ${plazas} plaza${plazas === 1 ? '' : 's'}`),
    li(`${city.plots.length} plots, frontage ${Math.min(...city.plots.map((p) => p.width))}–${Math.max(...city.plots.map((p) => p.width))} m`),
  );
  labels();
  writeHash();
}

view.onProgress = (done, total, detailed) => {
  $('progress').textContent = done < total ? `houses ${done}/${total}` : `${total} houses · ${detailed} detailed`;
};

view.onPick = (plot: PlotSpec | null, spec: HouseSpec | null) => {
  const box = $('pick');
  selected = plot ? plot.index : null;
  if (!plot) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  if (matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  const styleLabel = STYLES[plot.style as keyof typeof STYLES]?.label ?? plot.style;
  const h = document.createElement('h3');
  h.textContent = `Plot ${plot.id} · ${styleLabel}`;
  const p1 = document.createElement('p');
  p1.textContent = `${plot.width} × ${plot.depth} m · ${Math.round(plot.centrality * 100)}% towards the city centre · seed ${plot.seed}`;
  const ul = document.createElement('ul');
  for (const f of (spec?.features ?? []).slice(1, 5)) ul.append(Object.assign(document.createElement('li'), { textContent: f }));
  const open = document.createElement('button');
  open.className = 'primary';
  open.textContent = 'Open in house editor';
  open.addEventListener('click', () => {
    const e = plot.house.envelope;
    const q = new URLSearchParams({
      seed: plot.seed, x0: String(e.x), z0: String(e.z), x1: String(e.x + e.width), z1: String(e.z + e.depth),
      front: 'south', c: plot.centrality.toFixed(2), style: plot.style,
    });
    window.open(`./index.html#${q}`, '_blank');
  });
  box.replaceChildren(h, p1, ul, open);
};

function tick(): void {
  const t = view.controls.target;
  minimap.draw({ x: t.x, z: t.z }, { x: view.camera.position.x, z: view.camera.position.z }, selected);
  requestAnimationFrame(tick);
}

labels();
regenerate(true);
tick();

addMoreCue(document.querySelector<HTMLElement>('.panel')!);
