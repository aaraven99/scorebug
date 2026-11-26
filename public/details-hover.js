/** A web hover panel. Native Windows uses a separate window to preserve bounds. */
export function attachDetailsHover(target, { native = false, enabled = () => true } = {}) {
  let panel = null, frame = null, opening, closing;
  const origin = new URL(document.baseURI).origin;
  function position() {
    if (!panel) return;
    const rect = target.getBoundingClientRect();
    const width = Math.min(420, innerWidth - 16), height = Math.min(480, innerHeight - 16), gap = 10;
    let left = rect.right + gap, top = rect.top;
    if (innerWidth - rect.right < width + gap + 8) {
      if (rect.left >= width + gap + 8) left = rect.left - width - gap;
      else { left = rect.left + (rect.width - width) / 2; top = rect.top >= height + gap + 8 ? rect.top - height - gap : rect.bottom + gap; }
    }
    panel.style.cssText = `position:fixed;z-index:1000;width:${width}px;height:${height}px;left:${Math.max(8, Math.min(left, innerWidth - width - 8))}px;top:${Math.max(8, Math.min(top, innerHeight - height - 8))}px;`;
  }
  function close() {
    clearTimeout(opening); clearTimeout(closing);
    if (native) { window.scorebugDesktop?.hideDetails?.(); return; }
    panel?.remove(); panel = null; frame = null;
  }
  function open() {
    clearTimeout(opening); clearTimeout(closing);
    if (!enabled()) return;
    if (native) { window.scorebugDesktop?.showDetails?.(); return; }
    if (panel) return;
    panel = document.createElement('div'); panel.className = 'details-popover';
    frame = document.createElement('iframe'); frame.title = 'Live game details'; frame.src = new URL('/details.html?embedded=1', document.baseURI).href;
    frame.style.cssText = 'width:100%;height:100%;display:block;border:0;background:transparent;color-scheme:dark;';
    panel.append(frame); document.body.append(panel); position();
    panel.addEventListener('pointerenter', () => clearTimeout(closing));
    panel.addEventListener('pointerleave', () => { closing = setTimeout(close, 320); });
  }
  function delayedClose() { clearTimeout(opening); clearTimeout(closing); closing = setTimeout(close, 320); }
  if (!native) {
    target.tabIndex = 0;
    target.setAttribute('aria-label', 'Show live field position, latest play, and team stats');
    target.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    target.addEventListener('pointerenter', (event) => { if (event.pointerType === 'touch') return; clearTimeout(closing); opening = setTimeout(open, 420); });
    target.addEventListener('pointerleave', delayedClose);
    target.addEventListener('focusin', () => { clearTimeout(closing); });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { passive: true });
    window.addEventListener('message', (event) => { if (event.origin === origin && event.source === frame?.contentWindow && event.data?.type === 'scorebug:close-details') close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    window.addEventListener('pagehide', close);
  }
  return { open, close };
}
