/** "More settings" cue on phones while part of the side panel is scrolled out of view. */
export function addMoreCue(panel: HTMLElement): void {
  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = 'More settings ▾';
  panel.appendChild(more);
  const update = () => (more.hidden = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60);
  panel.addEventListener('scroll', update, { passive: true });
  const ro = new ResizeObserver(update);
  for (const el of [panel, ...panel.children]) ro.observe(el);
  more.addEventListener('click', () => panel.scrollBy({ top: panel.clientHeight * 0.7, behavior: 'smooth' }));
  update();
}
