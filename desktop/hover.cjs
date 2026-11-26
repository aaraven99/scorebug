'use strict';

// Pointer intent stays in the main process because Windows draggable regions
// do not reliably deliver mouse events to a renderer.
class HoverIntent {
  constructor({ openDelay = 420, closeDelay = 320 } = {}) {
    this.openDelay = openDelay;
    this.closeDelay = closeDelay;
    this.armed = false;
    this.dismissed = false;
    this.enteredAt = null;
    this.leftAt = null;
  }

  dismiss() {
    this.dismissed = true;
    this.enteredAt = null;
    this.leftAt = null;
  }

  opened() {
    this.dismissed = false;
    this.enteredAt = null;
    this.leftAt = null;
  }

  update({ now, overWidget, overDetails = false, inTransit = false, detailsOpen = false, blocked = false, keepOpen = false }) {
    if (blocked) {
      this.armed = false;
      this.enteredAt = null;
      this.leftAt = null;
      return detailsOpen ? 'close' : null;
    }
    // Do not open under an unmoved cursor as soon as the app appears.
    if (!overWidget) this.armed = true;
    if (this.dismissed) {
      if (!overWidget && !overDetails) this.dismissed = false;
      else return detailsOpen ? 'close' : null;
    }
    if (detailsOpen) {
      this.enteredAt = null;
      if (overWidget || overDetails || inTransit || keepOpen) {
        this.leftAt = null;
        return null;
      }
      if (this.leftAt === null) this.leftAt = now;
      return now - this.leftAt >= this.closeDelay ? 'close' : null;
    }
    this.leftAt = null;
    if (!overWidget || !this.armed) {
      this.enteredAt = null;
      return null;
    }
    if (this.enteredAt === null) this.enteredAt = now;
    if (now - this.enteredAt < this.openDelay) return null;
    this.enteredAt = null;
    return 'open';
  }
}

module.exports = { HoverIntent };
