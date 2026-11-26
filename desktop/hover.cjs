'use strict';

// Pointer intent stays in the main process because Windows draggable regions
// do not reliably deliver mouse events to a renderer.
class HoverIntent {
  constructor({ openDelay = 420, closeDelay = 320, switchDelay = 160 } = {}) {
    this.openDelay = openDelay;
    this.closeDelay = closeDelay;
    this.switchDelay = switchDelay;
    this.armed = false;
    this.dismissed = false;
    this.enteredAt = null;
    this.leftAt = null;
    this.candidateSide = null;
  }

  dismiss() {
    this.dismissed = true;
    this.enteredAt = null;
    this.leftAt = null;
    this.candidateSide = null;
  }

  opened() {
    this.dismissed = false;
    this.enteredAt = null;
    this.leftAt = null;
    this.candidateSide = null;
  }

  update({ now, overWidget, overDetails = false, inTransit = false, detailsOpen = false, blocked = false, keepOpen = false, side = null, activeSide = null }) {
    if (blocked) {
      this.armed = false;
      this.enteredAt = null;
      this.leftAt = null;
      this.candidateSide = null;
      return detailsOpen ? 'close' : null;
    }
    // Do not open under an unmoved cursor as soon as the app appears.
    if (!overWidget) this.armed = true;
    if (this.dismissed) {
      if (!overWidget && !overDetails) this.dismissed = false;
      else return detailsOpen ? 'close' : null;
    }
    if (detailsOpen) {
      if (side && activeSide && side !== activeSide) {
        if (this.candidateSide !== side || this.enteredAt === null) {
          this.candidateSide = side;
          this.enteredAt = now;
        }
        if (now - this.enteredAt >= this.switchDelay) {
          this.enteredAt = null;
          this.candidateSide = null;
          this.leftAt = null;
          return 'switch';
        }
      } else {
        this.enteredAt = null;
        this.candidateSide = null;
      }
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
      this.candidateSide = null;
      return null;
    }
    if (this.enteredAt === null || this.candidateSide !== side) {
      this.enteredAt = now;
      this.candidateSide = side;
    }
    if (now - this.enteredAt < this.openDelay) return null;
    this.enteredAt = null;
    return 'open';
  }
}

module.exports = { HoverIntent };
