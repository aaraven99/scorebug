'use strict';

/** macOS completes fullscreen changes asynchronously. Keep only the latest
 * requested state and wait for the native event before starting another one. */
class FullscreenTransitions {
  constructor(setNative) {
    this.setNative = setNative;
    this.value = false;
    this.target = false;
    this.pending = null;
  }

  request(value) {
    if (typeof value !== 'boolean') throw new TypeError('Fullscreen must be true or false');
    this.target = value;
    this.advance();
    return this.value;
  }

  settled(value) {
    const requested = this.pending !== null;
    this.value = value;
    this.pending = null;
    // A title-bar or operating-system change becomes the new desired state.
    if (!requested) this.target = value;
    this.advance();
  }

  advance() {
    if (this.pending !== null || this.target === this.value) return;
    this.pending = this.target;
    try { this.setNative(this.pending); }
    catch (error) { this.pending = null; this.target = this.value; throw error; }
  }
}

module.exports = { FullscreenTransitions };
