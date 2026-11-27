import test from 'node:test';
import assert from 'node:assert/strict';
import { imageFallbackLabel, installSvgImageRecovery } from '../public/svg-image-recovery.js';
import { renderScorebug } from '../public/scorebug.js';
import { referenceForLeague } from '../public/sport-fixtures.js';
import { SCOREBUG_STYLES } from '../public/scorebug-styles.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// The browser QA separately aborts actual requests in Chromium and WebKit.
// These small DOM doubles exercise delegation/lifecycle without a browser in
// the server/unit suite, including future nodes and independent documents.
class Element {
  constructor(document, namespace, name) {
    this.ownerDocument = document;
    this.namespaceURI = namespace;
    this.localName = name;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.style = {};
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, next) {
    node.remove();
    node.parentNode = this;
    const index = next ? this.children.indexOf(next) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  remove() {
    if (this.parentNode) {
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
    }
  }
}

class Document {
  listeners = [];
  addEventListener(type, callback, capture) { this.listeners.push({ type, callback, capture }); }
  createElementNS(namespace, tag) { return new Element(this, namespace, tag); }
  dispatch(type, target) { for (const entry of this.listeners) if (entry.type === type) entry.callback({ type, target }); }
}

function artwork(document, { marked = true, namespace = SVG_NAMESPACE, label = 'ARS', name = 'Arsenal' } = {}) {
  const group = document.createElementNS(SVG_NAMESPACE, 'g');
  const image = document.createElementNS(namespace, namespace === SVG_NAMESPACE ? 'image' : 'img');
  const sibling = document.createElementNS(SVG_NAMESPACE, 'text');
  sibling.textContent = 'Score';
  if (marked) image.setAttribute('data-scorebug-image', '');
  for (const [key, value] of Object.entries({ label, name, x: 100, y: 30, width: 50, height: 28 })) image.setAttribute(`data-fallback-${key}`, value);
  image.setAttribute('data-image-state', 'image');
  image.setAttribute('href', 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png');
  group.append(image, sibling);
  return { group, image, sibling };
}

test('artwork recovery labels preserve team abbreviations and use player initials', () => {
  assert.equal(imageFallbackLabel({ name: 'Arsenal', abbreviation: 'ARS' }), 'ARS');
  assert.equal(imageFallbackLabel({ name: '49ers', abbreviation: 'SF' }), 'SF');
  assert.equal(imageFallbackLabel({ name: 'Connecticut Huskies', abbreviation: 'UConn' }), 'UCONN');
  assert.equal(imageFallbackLabel({ name: 'North Carolina', abbreviation: 'N.C.' }), 'NC');
  assert.equal(imageFallbackLabel({ name: 'Kansas City Chiefs' }), 'KCC');
  assert.equal(imageFallbackLabel({ name: 'Adam Walton', abbreviation: 'A. Walton', kind: 'athlete' }), 'AW');
  assert.equal(imageFallbackLabel({ name: 'Iga Świątek', sport: 'tennis' }), 'IŚ');
  assert.equal(imageFallbackLabel({ name: 'J. J. Spaun', sport: 'golf' }), 'JS');
  assert.equal(imageFallbackLabel({ name: 'Lando Norris', sport: 'racing' }), 'LN');
  assert.equal(imageFallbackLabel({}), '—');
});

test('all scorebug designs annotate their images without showing replacement artwork before an error', () => {
  const game = referenceForLeague('epl');
  game.away.logo = 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png';
  game.home.logo = 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png';
  let count = 0;
  for (const style of SCOREBUG_STYLES) for (const orientation of ['horizontal', 'vertical']) {
    const svg = renderScorebug(game, { styleId: style.id, orientation });
    const images = [...svg.matchAll(/<image\b[^>]+>/g)].map(([tag]) => tag);
    for (const image of images) {
      assert.match(image, /data-scorebug-image=""/);
      assert.match(image, /data-image-state="image"/);
      assert.match(image, /data-fallback-label="(?:ARS|CHE)"/);
      assert.doesNotMatch(image, /\sdisplay=|\son(?:error|load)=/);
      for (const name of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(Number(image.match(new RegExp(`data-fallback-${name}="([^"]+)"`))?.[1])));
      count++;
    }
    assert.doesNotMatch(svg, /data-scorebug-image-fallback/);
  }
  assert.ok(count > 200, `${count} images were checked`);
});

test('one delegated capture pair handles future images, repeated errors and later recovery', () => {
  const document = new Document();
  assert.equal(installSvgImageRecovery(document), true);
  for (let index = 0; index < 1000; index++) assert.equal(installSvgImageRecovery(document), false);
  assert.deepEqual(document.listeners.map(({ type, capture }) => ({ type, capture })), [{ type: 'error', capture: true }, { type: 'load', capture: true }]);
  const { group, image, sibling } = artwork(document);
  assert.deepEqual(group.children, [image, sibling]);
  document.dispatch('error', image);
  assert.equal(image.getAttribute('display'), 'none');
  assert.equal(image.getAttribute('data-image-state'), 'error');
  const fallback = image.nextSibling;
  assert.ok(fallback.hasAttribute('data-scorebug-image-fallback'));
  assert.equal(fallback.getAttribute('aria-label'), 'Arsenal: image unavailable');
  assert.equal(fallback.children.at(-1).textContent, 'ARS');
  assert.equal(fallback.nextSibling, sibling, 'the score/caption order remains unchanged');
  const rect = fallback.children.find(node => node.localName === 'rect');
  assert.ok(Number(rect.getAttribute('width')) <= 50);
  assert.ok(Number(rect.getAttribute('height')) <= 28);
  assert.equal(Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2, 100);
  assert.equal(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2, 30);
  document.dispatch('error', image);
  assert.equal(group.children.length, 3, 'repeat failures must not duplicate the badge');
  document.dispatch('load', image);
  assert.equal(image.getAttribute('display'), null);
  assert.equal(image.getAttribute('data-image-state'), 'image');
  assert.deepEqual(group.children, [image, sibling]);
  document.dispatch('error', image);
  assert.equal(group.children.length, 3, 'the same image can fail again after a successful load');
  const fresh = artwork(document);
  document.dispatch('load', fresh.image);
  assert.equal(fresh.group.children.length, 2, 'newly rendered working artwork has no fallback');
  assert.equal(document.listeners.length, 2, 'render replacement does not install image listeners');
});

test('recovery is isolated by document and ignores unrelated HTML, scripts and unmarked SVG images', () => {
  assert.equal(installSvgImageRecovery(undefined), false);
  const document = new Document(), popout = new Document();
  installSvgImageRecovery(document);
  installSvgImageRecovery(popout);
  assert.equal(popout.listeners.length, 2);
  for (const options of [{ marked: false }, { namespace: 'http://www.w3.org/1999/xhtml' }]) {
    const { group, image } = artwork(document, options);
    document.dispatch('error', image);
    assert.equal(group.children.length, 2);
    assert.equal(image.getAttribute('data-image-state'), 'image');
  }
  document.dispatch('error', document.createElementNS('http://www.w3.org/1999/xhtml', 'script'));
  const { group, image } = artwork(popout);
  popout.dispatch('error', image);
  assert.equal(group.children.length, 3);
  assert.equal(image.nextSibling.ownerDocument, popout);
  image.remove();
  assert.doesNotThrow(() => popout.dispatch('error', image));
  assert.doesNotThrow(() => popout.dispatch('load', image));
});

test('recovery identifiers cannot inject SVG markup and unsafe geometry is rejected', () => {
  const document = new Document();
  installSvgImageRecovery(document);
  const hostile = artwork(document, { name: '"><script>alert(1)</script>', label: '<x>' });
  document.dispatch('error', hostile.image);
  assert.equal(hostile.image.nextSibling.children.at(-1).textContent, '<x>');
  assert.equal(hostile.image.nextSibling.children[0].textContent, '"><script>alert(1)</script>: image unavailable');
  assert.ok(hostile.image.nextSibling.children.every(node => ['title', 'rect', 'text'].includes(node.localName)));
  const malformed = artwork(document);
  malformed.image.setAttribute('data-fallback-width', 'Infinity');
  document.dispatch('error', malformed.image);
  assert.equal(malformed.group.children.length, 2);
});
