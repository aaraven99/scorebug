'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HoverIntent } = require('./hover.cjs');

test('a stationary startup cursor does not open details, but a deliberate dwell does', () => {
  const hover = new HoverIntent();
  assert.equal(hover.update({ now: 0, overWidget: true }), null);
  assert.equal(hover.update({ now: 1000, overWidget: true }), null);
  hover.update({ now: 1100, overWidget: false });
  assert.equal(hover.update({ now: 1200, overWidget: true }), null);
  assert.equal(hover.update({ now: 1600, overWidget: true }), null);
  assert.equal(hover.update({ now: 1620, overWidget: true }), 'open');
});

test('moving into the details panel through its gap keeps it open and resets dismissal', () => {
  const hover = new HoverIntent();
  hover.opened();
  assert.equal(hover.update({ now: 0, detailsOpen: true, overWidget: true }), null);
  assert.equal(hover.update({ now: 100, detailsOpen: true, overWidget: false, inTransit: true }), null);
  assert.equal(hover.update({ now: 500, detailsOpen: true, overWidget: false, overDetails: true }), null);
  assert.equal(hover.update({ now: 600, detailsOpen: true, overWidget: false }), null);
  assert.equal(hover.update({ now: 900, detailsOpen: true, overWidget: false }), null);
  assert.equal(hover.update({ now: 920, detailsOpen: true, overWidget: false }), 'close');
});

test('explicitly dismissed details do not immediately reopen under the pointer', () => {
  const hover = new HoverIntent();
  hover.update({ now: 0, overWidget: false });
  hover.dismiss();
  assert.equal(hover.update({ now: 1000, overWidget: true }), null);
  assert.equal(hover.update({ now: 5000, overWidget: true }), null);
  hover.update({ now: 5100, overWidget: false });
  hover.update({ now: 5200, overWidget: true });
  assert.equal(hover.update({ now: 5620, overWidget: true }), 'open');
});

test('dragging closes the panel and keyboard-opened focus can keep it available', () => {
  const hover = new HoverIntent();
  assert.equal(hover.update({ now: 0, overWidget: false, detailsOpen: true, keepOpen: true }), null);
  assert.equal(hover.update({ now: 1000, overWidget: false, detailsOpen: true, keepOpen: true }), null);
  assert.equal(hover.update({ now: 1100, overWidget: true, detailsOpen: true, blocked: true }), 'close');
  assert.equal(hover.update({ now: 2000, overWidget: true, detailsOpen: false }), null);
});
