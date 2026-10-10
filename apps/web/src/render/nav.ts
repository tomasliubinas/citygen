import * as THREE from 'three';

type Controls = { mouseButtons: Record<string, THREE.MOUSE | null | undefined>; touches: Record<string, THREE.TOUCH | null | undefined> };

/** Mouse outline with one part filled: 'l' / 'r' button or 'w' wheel. */
const mouse = (part: 'l' | 'r' | 'w') => {
  const fill =
    part === 'l' ? '<path d="M12 3a6 6 0 0 0-6 6v1h6z" fill="currentColor"/>'
    : part === 'r' ? '<path d="M12 3a6 6 0 0 1 6 6v1h-6z" fill="currentColor"/>'
    : '<rect x="11" y="5.5" width="2" height="4" rx="1" fill="currentColor"/>';
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="3" width="12" height="18" rx="6"/>${part === 'w' ? '' : '<path d="M6 10h12M12 3v7"/>'}${fill}</svg>`;
};

/** One-line navigation hint (bottom-left): left-drag rotates, right-drag or modifier+drag moves. */
export function addNavHint(container: HTMLElement, controls: Controls): void {
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = document.createElement('div');
  hint.className = 'nav-hint';
  hint.innerHTML = touch
    ? '1 finger rotates · 2 fingers move and zoom'
    : `<span>${mouse('l')} rotate</span><span>${mouse('r')} move</span><span>${mouse('w')} zoom</span>` +
      `<span class="alt">${mac ? '⌘' : 'Ctrl'}/Shift + drag: move</span>`;
  hint.insertAdjacentHTML('beforeend', '<button class="x" title="Hide">×</button>');
  const open = document.createElement('button');
  open.className = 'nav-open';
  open.title = 'How to navigate';
  open.textContent = '?';
  container.append(hint, open);
  // Collapsed into a "?" button; remembered per browser.
  const show = (on: boolean) => {
    hint.hidden = !on;
    open.hidden = on;
    try { localStorage.setItem('citygen-hint', on ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  let saved: string | null = null;
  try { saved = localStorage.getItem('citygen-hint'); } catch { /* storage unavailable */ }
  show(saved !== '0');
  hint.querySelector('.x')!.addEventListener('click', () => show(false));
  open.addEventListener('click', () => show(true));
}
