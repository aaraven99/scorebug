/** Team-specific outward expansions. Windows uses a separate transparent window. */
export function attachDetailsHover(target, { native = false, enabled = () => true, defaultSide = () => 'home' } = {}) {
  let panel = null, frame = null, side = null, pendingSide = null, opening, closing;
  const origin = new URL(document.baseURI).origin;
  function teamElement(value) { return target.querySelector(`[data-team-side="${value}"]`); }
  function position() {
    if (!panel) return;
    const rect = (teamElement(side) || target).getBoundingClientRect();
    const width = Math.min(220, innerWidth - 12), height = Math.min(230, innerHeight - 12);
    let direction = side === 'away' ? 'left' : 'right';
    const fitsLeft = rect.left - width >= 6, fitsRight = rect.right + width <= innerWidth - 6;
    if (direction === 'left' && !fitsLeft && fitsRight) direction = 'right';
    if (direction === 'right' && !fitsRight && fitsLeft) direction = 'left';
    const left = direction === 'left' ? rect.left - width + 1 : rect.right - 1;
    panel.dataset.direction = direction;
    panel.style.cssText = `position:fixed;z-index:1000;width:${width}px;height:${height}px;left:${Math.max(6, Math.min(left, innerWidth - width - 6))}px;top:${Math.max(6, Math.min(rect.top, innerHeight - height - 6))}px;`;
  }
  function close() {
    clearTimeout(opening); clearTimeout(closing); pendingSide = null;
    if (native) { window.scorebugDesktop?.hideDetails?.(); return; }
    if (side) teamElement(side)?.setAttribute('aria-expanded', 'false');
    panel?.remove(); panel = null; frame = null; side = null;
  }
  function open(value = defaultSide()) {
    clearTimeout(opening); clearTimeout(closing); pendingSide = null;
    if (!enabled()) return;
    value = value === 'away' ? 'away' : 'home';
    if (native) { window.scorebugDesktop?.showDetails?.(value); return; }
    if (side) teamElement(side)?.setAttribute('aria-expanded', 'false');
    const changed = side !== value; side = value;
    teamElement(side)?.setAttribute('aria-expanded', 'true');
    if (panel) {
      frame.title = `${side === 'away' ? 'Away' : 'Home'} team stats`;
      if (changed) frame.contentWindow?.postMessage({ type: 'scorebug:details-side', side }, origin);
      position(); return;
    }
    panel = document.createElement('div'); panel.className = 'details-popover';
    frame = document.createElement('iframe'); frame.title = `${side === 'away' ? 'Away' : 'Home'} team stats`;
    const url = new URL('/details.html', document.baseURI); url.searchParams.set('embedded', '1'); url.searchParams.set('side', side);
    frame.src = url.href;
    frame.style.cssText = 'width:100%;height:100%;display:block;border:0;background:transparent;color-scheme:dark;';
    frame.addEventListener('load', () => frame?.contentWindow?.postMessage({ type: 'scorebug:details-side', side }, origin));
    panel.append(frame); document.body.append(panel); position();
    panel.addEventListener('pointerenter', () => { clearTimeout(opening); clearTimeout(closing); });
    panel.addEventListener('pointerleave', delayedClose);
  }
  function delayedClose() { clearTimeout(opening); clearTimeout(closing); pendingSide = null; closing = setTimeout(close, 320); }
  function schedule(value) {
    clearTimeout(closing);
    if (value === side || value === pendingSide) return;
    clearTimeout(opening); pendingSide = value;
    opening = setTimeout(() => open(value), panel ? 160 : 360);
  }
  target.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const team = event.target.closest?.('[data-team-side]');
    if (team) { event.preventDefault(); open(team.dataset.teamSide); }
  });
  if (!native) {
    target.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const team = event.target.closest?.('[data-team-side]');
      if (team && target.contains(team)) schedule(team.dataset.teamSide);
      else delayedClose();
    });
    target.addEventListener('pointerleave', delayedClose);
    target.addEventListener('focusin', (event) => { const team = event.target.closest?.('[data-team-side]'); if (team) schedule(team.dataset.teamSide); });
    target.addEventListener('click', (event) => { const team = event.target.closest?.('[data-team-side]'); if (team) open(team.dataset.teamSide); });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { passive: true });
    window.addEventListener('message', (event) => { if (event.origin === origin && event.source === frame?.contentWindow && event.data?.type === 'scorebug:close-details') close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('pagehide', close);
    new ResizeObserver(position).observe(target);
  }
  return { open, close };
}
