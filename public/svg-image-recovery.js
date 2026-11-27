/** Keep unavailable remote artwork readable without replacing a working logo. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const installedDocuments = new WeakSet();
const fallbacks = new WeakMap();

function words(value) {
  return String(value || '').normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
}

/** A text identifier, never an invented team crest or player portrait. */
export function imageFallbackLabel(team) {
  const name = words(team?.name || team?.shortName || team?.abbreviation);
  const athlete = team?.kind === 'athlete' || ['tennis', 'golf', 'racing'].includes(team?.sport);
  if (athlete && name.length) {
    return (name[0][0] + (name.length > 1 ? name.at(-1)[0] : '')).toLocaleUpperCase('en-US');
  }
  const abbreviation = words(team?.abbreviation).join('').toLocaleUpperCase('en-US');
  if (abbreviation && abbreviation.length <= 6) return abbreviation;
  return (name.length > 1 ? name.slice(0, 4).map(part => part[0]).join('') : (name[0] || '').slice(0, 3)).toLocaleUpperCase('en-US') || '—';
}

function numberAttribute(image, name) {
  const value = image.getAttribute(`data-fallback-${name}`);
  const number = value === null || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(number) && Math.abs(number) < 100000 ? number : null;
}

function element(document, tag, attributes) {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function showFallback(image) {
  if (!image.parentNode) return;
  let fallback = fallbacks.get(image);
  if (!fallback || fallback.parentNode !== image.parentNode) {
    const x = numberAttribute(image, 'x'), y = numberAttribute(image, 'y');
    const maxWidth = numberAttribute(image, 'width'), maxHeight = numberAttribute(image, 'height');
    if (x === null || y === null || maxWidth === null || maxHeight === null || maxWidth <= 0 || maxHeight <= 0) return;
    const label = image.getAttribute('data-fallback-label') || '—';
    const name = image.getAttribute('data-fallback-name') || label;
    const height = Math.min(maxHeight, 34), padding = Math.min(5, height * .16);
    const fontSize = Math.min(height * .62, (maxWidth - padding * 2) / Math.max(1, [...label].length * .72));
    const width = Math.min(maxWidth, Math.max(height, [...label].length * fontSize * .72 + padding * 2));
    const document = image.ownerDocument;
    fallback = element(document, 'g', {
      class: 'bug-team-logo-fallback', 'data-scorebug-image-fallback': '',
      role: 'img', 'aria-label': `${name}: image unavailable`, 'pointer-events': 'none',
    });
    const title = element(document, 'title', {});
    title.textContent = `${name}: image unavailable`;
    const background = element(document, 'rect', {
      x: x - width / 2, y: y - height / 2, width, height,
      rx: Math.min(4, height * .15), fill: '#15212b', stroke: '#d7e0e5', 'stroke-width': .75,
    });
    const text = element(document, 'text', {
      class: 'variant-text bug-team-logo-fallback-label', x, y: y + fontSize * .35,
      'text-anchor': 'middle', 'font-size': fontSize, fill: '#ffffff', 'aria-hidden': 'true',
    });
    // Existing scorebug themes intentionally style all SVG text. Keep this
    // small recovery badge consistently legible in every theme, using the
    // existing CSP's permitted presentation styles, never inline JavaScript.
    text.style.fontFamily = 'Arial, Helvetica, sans-serif';
    text.style.fontStyle = 'normal';
    text.style.fontWeight = '700';
    text.style.letterSpacing = '0';
    text.style.fill = '#ffffff';
    text.textContent = label;
    fallback.append(title, background, text);
    image.parentNode.insertBefore(fallback, image.nextSibling);
    fallbacks.set(image, fallback);
  }
  image.setAttribute('display', 'none');
  image.setAttribute('data-image-state', 'error');
}

function restoreImage(image) {
  const fallback = fallbacks.get(image);
  if (fallback) {
    fallback.remove();
    fallbacks.delete(image);
  }
  image.removeAttribute('display');
  image.setAttribute('data-image-state', 'image');
}

/**
 * A single capture listener pair covers current and subsequently rendered SVGs.
 * Each page/runtime, including Picture-in-Picture, installs on its own document.
 * Weak collections do not retain removed scorebugs; no observers, retries or
 * per-image listeners are created as live updates replace SVG markup.
 * The state attribute describes the displayed element, not download progress:
 * browsers do not consistently propagate successful SVG image load events.
 * Fresh renders always try the actual image again; an error shows the badge.
 */
export function installSvgImageRecovery(document = globalThis.document) {
  if (!document?.addEventListener || installedDocuments.has(document)) return false;
  const imageFrom = event => {
    const image = event.target;
    return image?.namespaceURI === SVG_NAMESPACE && image.localName === 'image'
      && image.hasAttribute('data-scorebug-image') ? image : null;
  };
  document.addEventListener('error', event => {
    const image = imageFrom(event);
    if (image) showFallback(image);
  }, true);
  document.addEventListener('load', event => {
    const image = imageFrom(event);
    if (image) restoreImage(image);
  }, true);
  installedDocuments.add(document);
  return true;
}
