// Animation engine. A move commits the logical state immediately, then drives a
// per-frame 4D rotation that the projector turns into the visible morph.
import { executeMove, executeMiddleMove, middleNetSign, CELLS } from './puzzle.js';
import { PLANE_AXES, mat4Mul, mat4MulVec4, mat4PlaneRotation } from './math4d.js';

const MOVE_DURATION       = 360; // ms per cell turn
const TRANSITION_DURATION = 620; // ms for central-cell change

export class AnimationEngine {
  constructor() {
    this.moveQueue   = [];
    this.active      = null;
    this.speedFactor = 1.0;
    this.onMoveComplete = null;
    this.onCentralComplete = null;
  }

  queueMove(cubies, cellIndex, planeName, sign) {
    this.moveQueue.push({ type: 'move', cubies, cellIndex, planeName, sign });
  }
  queueMiddle(cubies, centralCellIndex, fAxis, planeName, sign) {
    this.moveQueue.push({ type: 'middle', cubies, centralCellIndex, fAxis, planeName, sign });
  }
  queueCentralCell(fromCellIndex, toCellIndex) {
    this.moveQueue.push({ type: 'central', fromCellIndex, toCellIndex });
  }

  tick(timestamp, cubies, centralCellIndex) {
    if (!this.active && this.moveQueue.length > 0) this._startNext(timestamp, cubies, centralCellIndex);
    if (!this.active) return null;

    const a = this.active;
    const rawT = Math.min((timestamp - a.startTime) / (a.duration / this.speedFactor), 1.0);
    if (rawT >= 1.0) { this._finishActive(); return null; }
    const t = easeInOut(rawT);

    if (a.type === 'move' || a.type === 'middle') {
      const getState = (i) => {
        const pre = a.pre.get(i);
        if (!pre) return null;                       // unaffected → committed state
        const ns = pre.ns !== undefined ? pre.ns : 1; // per-cubie net sign (±1; middle slices mix)
        const R = mat4PlaneRotation(a.planeA, a.planeB, a.totalAngle * ns * t);
        return { center4: mat4MulVec4(R, pre.center), orient: mat4Mul(R, pre.orient) };
      };
      // A single-cell turn spins that core-cell wireframe; a middle slice spins no whole
      // cell (just the centred cube's middle layer), so report cellIndex −1 / no R.
      const single = a.type === 'move';
      return { type: 'move', getState, cellIndex: single ? a.cellIndex : -1,
               R: single ? mat4PlaneRotation(a.planeA, a.planeB, a.totalAngle * t) : null };
    }
    // Centering: report raw progress; main eases + rotates the core frame.
    return { type: 'central', fromCellIndex: a.fromCellIndex, toCellIndex: a.toCellIndex, t: rawT };
  }

  isIdle() { return !this.active && this.moveQueue.length === 0; }
  isBusy() { return !this.isIdle(); }
  clearQueue() { this.moveQueue = []; this.active = null; }

  _startNext(timestamp, cubies, centralCellIndex) {
    const next = this.moveQueue.shift();
    next.startTime = timestamp;

    if (next.type === 'move') {
      next.duration = MOVE_DURATION;
      const { axis, val } = CELLS[next.cellIndex];
      [next.planeA, next.planeB] = PLANE_AXES[next.planeName];
      next.totalAngle = next.sign * Math.PI / 2;

      // Snapshot pre-move 4D centre and orientation of the affected cubies.
      next.pre = new Map();
      cubies.forEach((c, i) => {
        if (c.pos4[axis] === val) {
          next.pre.set(i, {
            center: Float64Array.from(c.pos4),
            orient: new Float64Array(c.orient),
          });
        }
      });

      next.descriptor = executeMove(cubies, next.cellIndex, next.planeName, next.sign);
    } else if (next.type === 'middle') {
      next.duration = MOVE_DURATION;
      [next.planeA, next.planeB] = PLANE_AXES[next.planeName];
      next.totalAngle = next.sign * Math.PI / 2;
      next.pre = new Map();
      cubies.forEach((c, i) => {
        const ns = middleNetSign(c, next.centralCellIndex, next.fAxis);
        if (ns !== 0) next.pre.set(i, { center: Float64Array.from(c.pos4), orient: new Float64Array(c.orient), ns });
      });
      next.descriptor = executeMiddleMove(cubies, next.centralCellIndex, next.fAxis, next.planeName, next.sign);
    } else {
      next.duration = TRANSITION_DURATION;
    }
    this.active = next;
  }

  _finishActive() {
    const a = this.active;
    if ((a.type === 'move' || a.type === 'middle') && this.onMoveComplete) this.onMoveComplete(a.descriptor);
    if (a.type === 'central' && this.onCentralComplete) this.onCentralComplete();
    this.active = null;
  }
}

function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }
