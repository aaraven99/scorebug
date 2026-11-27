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

test('opening requires a deliberate dwell on the same team', () => {
  const hover = new HoverIntent();
  hover.update({ now: 0, overWidget: false });
  assert.equal(hover.update({ now: 100, overWidget: true, side: 'away' }), null);
  assert.equal(hover.update({ now: 500, overWidget: true, side: 'home' }), null);
  assert.equal(hover.update({ now: 700, overWidget: true, side: 'home' }), null);
  assert.equal(hover.update({ now: 920, overWidget: true, side: 'home' }), 'open');
});

test('crossing to the other colored team switches the existing extension after a short dwell', () => {
  const hover = new HoverIntent();
  hover.opened();
  assert.equal(hover.update({ now: 0, overWidget: true, detailsOpen: true, side: 'home', activeSide: 'home' }), null);
  assert.equal(hover.update({ now: 100, overWidget: true, detailsOpen: true, side: 'away', activeSide: 'home' }), null);
  assert.equal(hover.update({ now: 250, overWidget: true, detailsOpen: true, side: 'away', activeSide: 'home' }), null);
  assert.equal(hover.update({ now: 260, overWidget: true, detailsOpen: true, side: 'away', activeSide: 'home' }), 'switch');
  assert.equal(hover.update({ now: 300, overWidget: false, overDetails: true, detailsOpen: true, activeSide: 'away' }), null);
});

test('the clock switches to comparison and moving onto score-only space closes a hover blade', () => {
  const hover = new HoverIntent();
  hover.opened();
  assert.equal(hover.update({ now: 100, detailsOpen: true, overWidget: true, side: 'comparison', activeSide: 'away' }), null);
  assert.equal(hover.update({ now: 260, detailsOpen: true, overWidget: true, side: 'comparison', activeSide: 'away' }), 'switch');
  assert.equal(hover.update({ now: 300, detailsOpen: true, overWidget: false, side: null, activeSide: 'comparison' }), null);
  assert.equal(hover.update({ now: 620, detailsOpen: true, overWidget: false, side: null, activeSide: 'comparison' }), 'close');
});
