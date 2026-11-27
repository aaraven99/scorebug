'use strict';

const DETAILS_OPEN_MS = 240;
const DETAILS_EXIT_MS = 260;

// Retain one native window while its renderer retracts. Each transition owns a
// generation so a queued callback from an old close cannot destroy a reopened
// panel or a newly created replacement.
class DetailsLifecycle {
  constructor({
    onPhase = () => {},
    onClosed = () => {},
    timers = { setTimeout, clearTimeout },
    openDuration = DETAILS_OPEN_MS,
    exitDuration = DETAILS_EXIT_MS
  } = {}) {
    this.onPhase = onPhase;
    this.onClosed = onClosed;
    this.timers = timers;
    this.openDuration = openDuration;
    this.exitDuration = exitDuration;
    this.owner = null;
    this.phase = 'closed';
    this.generation = 0;
    this.timer = null;
  }

  clearTimer() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  phaseFor(owner) {
    return owner && owner === this.owner ? this.phase : 'closed';
  }

  open(owner) {
    if (!owner) return;
    this.clearTimer();
    this.owner = owner;
    const generation = ++this.generation;
    this.phase = 'opening';
    this.onPhase(owner, this.phase);
    this.timer = this.timers.setTimeout(() => {
      if (this.owner !== owner || this.generation !== generation) return;
      this.timer = null;
      this.phase = 'open';
      this.onPhase(owner, this.phase);
    }, this.openDuration);
    this.timer?.unref?.();
  }

  close(owner, { immediate = false } = {}) {
    if (!owner) return;
    // A not-yet-shown window has no opening transition and should disappear
    // immediately instead of becoming visible after its caller dismissed it.
    if (this.owner !== owner) {
      if (immediate) this.onClosed(owner);
      return;
    }
    if (!immediate && this.phase === 'closing') return;
    this.clearTimer();
    const generation = ++this.generation;
    const finish = () => {
      if (this.owner !== owner || this.generation !== generation) return;
      this.timer = null;
      this.phase = 'closed';
      this.onPhase(owner, this.phase);
      this.owner = null;
      this.onClosed(owner);
    };
    if (immediate) { finish(); return; }
    this.phase = 'closing';
    this.onPhase(owner, this.phase);
    this.timer = this.timers.setTimeout(finish, this.exitDuration);
    this.timer?.unref?.();
  }

  forget(owner) {
    if (this.owner !== owner) return;
    this.clearTimer();
    ++this.generation;
    this.owner = null;
    this.phase = 'closed';
  }
}

module.exports = { DetailsLifecycle, DETAILS_OPEN_MS, DETAILS_EXIT_MS };
