import * as THREE from 'three';

type Controls = { mouseButtons: Record<string, THREE.MOUSE | null | undefined>; touches: Record<string, THREE.TOUCH | null | undefined> };

const ICON_ROTATE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>';
const ICON_PAN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg>';

/** Small overlay: choose whether left-drag / one-finger drag rotates or moves the view. */
export function addNavToggle(container: HTMLElement, controls: Controls): void {
  const bar = document.createElement('div');
  bar.className = 'nav-toggle';
  bar.innerHTML = `<button data-m="rotate" title="Drag rotates (right-drag moves)">${ICON_ROTATE}</button><button data-m="pan" title="Drag moves (right-drag rotates)">${ICON_PAN}</button>`;
  container.appendChild(bar);
  const set = (m: 'rotate' | 'pan') => {
    const rot = m === 'rotate';
    controls.mouseButtons.LEFT = rot ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = rot ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = rot ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
    for (const b of bar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === m);
    try { localStorage.setItem('citygen-nav', m); } catch { /* storage unavailable */ }
  };
  let saved: string | null = null;
  try { saved = localStorage.getItem('citygen-nav'); } catch { /* storage unavailable */ }
  set(saved === 'pan' ? 'pan' : 'rotate');
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) set(b.dataset.m as 'rotate' | 'pan');
  });
}
