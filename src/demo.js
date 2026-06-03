// Demo mode: automatic sequenced playback of all 48 moves
import { buildDemoSequence } from './puzzle.js';

export class DemoMode {
  constructor() {
    this.sequence = buildDemoSequence(); // 48 moves
    this.index = -1;   // current position (-1 = not started)
    this.playing = false;
    this.loop = false;
    this.waitingForAnim = false;
  }

  start(fromIndex = 0) {
    this.index = fromIndex - 1; // will be incremented on first step
    this.playing = true;
    this.waitingForAnim = false;
  }

  pause()  { this.playing = false; }
  resume() { this.playing = true; }
  stop()   { this.playing = false; this.index = -1; this.waitingForAnim = false; }

  stepForward()  { this.index = Math.min(this.index + 1, this.sequence.length - 1); }
  stepBackward() { this.index = Math.max(this.index - 1, 0); }

  // Returns the next move to execute, or null if none pending.
  // Should be called each frame when playing and animation is idle.
  getNextMove(animIsIdle) {
    if (!this.playing || !animIsIdle || this.waitingForAnim) return null;

    const nextIndex = this.index + 1;

    if (nextIndex >= this.sequence.length) {
      if (this.loop) {
        this.index = -1;
        return this.getNextMove(animIsIdle);
      } else {
        this.playing = false;
        return null;
      }
    }

    this.index = nextIndex;
    this.waitingForAnim = true;
    return { ...this.sequence[this.index], demoIndex: this.index };
  }

  // Called when animation for the last dispatched move completes
  onMoveComplete() {
    this.waitingForAnim = false;
  }

  isFinished() {
    return !this.playing && this.index >= this.sequence.length - 1;
  }

  getProgress() {
    return { current: this.index + 1, total: this.sequence.length };
  }
}
