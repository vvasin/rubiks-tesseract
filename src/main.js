import { mat3Mul, mat3AxisRotation } from './math4d.js';
import { buildSolvedPuzzle, undoMove, CELLS } from './puzzle.js';
import { computeCells, computeWireframe, computeCoreWireframe, frameForCell, cloneFrame, rotateFrame,
         centeringPlan, centralFromFrame } from './projection.js';
import { Renderer } from './renderer.js';
import { AnimationEngine } from './animation.js';
import { Controls, buildCellPanel, updateCentralBadge } from './controls.js';
import { DemoMode } from './demo.js';

class App {
  constructor() {
    this.cubies = buildSolvedPuzzle();
    this.centralCellIndex = 0;
    this.coreFrame = frameForCell(0);     // explicit 4D core orientation
    this.pendingCenter = null;            // active centering {fromFrame, plan, toCi}
    this.showWire = false;                // wireframe toggle (cubies + core as wireframes)
    // Turntable view: independent yaw (around world Y) and pitch (around screen X).
    // Keeping them as separate angles — rather than accumulating free rotations —
    // means horizontal drag never leaks into roll, so the puzzle stays upright.
    this.viewYaw   = -Math.PI / 5.5;      // ~33° → shows the right faces
    this.viewPitch =  Math.PI / 7;        // ~26° → shows the top faces
    this.viewZoom  = 1.0;                 // camera-distance multiplier
    this.viewRot = this._composeViewRot();
    this.mode = 'regular'; // 'regular' | 'demo'

    this.undoStack = [];
    this.redoStack = [];

    this.anim = new AnimationEngine();
    this.anim.onMoveComplete = (desc) => this._onMoveComplete(desc);
    this.anim.onCentralComplete = () => this._onCentralComplete();

    this.demo = new DemoMode();
    this.demoSpeedFactor = 1.0;

    this.canvas = document.getElementById('glcanvas');
    this.renderer = new Renderer(this.canvas);

    this.controls = new Controls(this.canvas, this);
    buildCellPanel(document.getElementById('cell-panel'), this);
    updateCentralBadge(document.getElementById('cell-panel'), this.centralCellIndex);

    this._bindUI();
    this._updateMoveCounter();

    requestAnimationFrame(ts => this._loop(ts));
  }

  // ── Render loop ──────────────────────────────────────────────────────────────

  _loop(timestamp) {
    // Drive demo
    if (this.mode === 'demo' && this.demo.playing) {
      const move = this.demo.getNextMove(this.anim.isIdle());
      if (move) {
        this.anim.queueMove(this.cubies, move.cellIndex, move.planeName, move.sign);
        this._updateMoveCounter(move.demoIndex + 1);
      }
    }

    // Tick animation
    const frame = this.anim.tick(timestamp, this.cubies, this.centralCellIndex);

    // Determine the core frame to project with this instant.
    let coreFrame = this.coreFrame;
    if (frame && frame.type === 'central' && this.pendingCenter) {
      const { fromFrame, plan } = this.pendingCenter;
      coreFrame = rotateFrame(fromFrame, plan.a, plan.b, plan.angle * easeInOut(frame.t));
    }

    const getState = frame && frame.type === 'move' ? frame.getState : null;

    // Wireframe mode replaces the solid cubies with cell wireframes + the core.
    let cells, segments = null;
    if (this.showWire) {
      cells = [];
      segments = computeWireframe(this.cubies, coreFrame, getState);
      // All 8 core boxes are always shown; the turning cell spins with the move,
      // and the whole set rotates with the interpolated frame during recentering.
      const spinCell = frame && frame.type === 'move' ? frame.cellIndex : -1;
      const spinR    = frame && frame.type === 'move' ? frame.R : null;
      segments = segments.concat(
        computeCoreWireframe(coreFrame, [0, 1, 2, 3, 4, 5, 6, 7], spinCell, spinR));
    } else {
      cells = computeCells(this.cubies, coreFrame, getState);
    }

    this.renderer.draw(cells, this.viewRot, segments, 15 / this.viewZoom);
    requestAnimationFrame(ts => this._loop(ts));
  }

  // ── App actions (called by controls) ────────────────────────────────────────

  _composeViewRot() {
    return mat3Mul(mat3AxisRotation(0, this.viewPitch), mat3AxisRotation(1, this.viewYaw));
  }

  // Orbit the camera by yaw/pitch deltas (radians). Pitch is clamped just shy of
  // the poles so the view can't flip over or gimbal-lock.
  orbit(dYaw, dPitch) {
    const maxPitch = Math.PI / 2;   // allow a true straight-down / straight-up view
    this.viewYaw += dYaw;
    this.viewPitch = Math.max(-maxPitch, Math.min(maxPitch, this.viewPitch + dPitch));
    this.viewRot = this._composeViewRot();
  }

  zoomBy(factor) {
    this.viewZoom = Math.max(0.5, Math.min(2.2, this.viewZoom * factor));
  }

  resetView() {
    this.viewYaw   = -Math.PI / 5.5;
    this.viewPitch =  Math.PI / 7;
    this.viewZoom  = 1.0;
    this.viewRot = this._composeViewRot();
  }

  selectCentralCell(cellIndex) {
    if (cellIndex === this.centralCellIndex) return;
    if (this.anim.isBusy()) return;   // one reorientation at a time
    // Real 4D centering: rotate the core frame from the current cell to this one.
    this.pendingCenter = {
      fromFrame: cloneFrame(this.coreFrame),
      plan: centeringPlan(this.coreFrame, cellIndex),
      toCi: cellIndex,
    };
    this.anim.queueCentralCell(this.centralCellIndex, cellIndex);
    this.centralCellIndex = cellIndex;
    updateCentralBadge(document.getElementById('cell-panel'), cellIndex);
    this._setStatus(`Central cell: ${CELLS[cellIndex].name}`);
  }

  _onCentralComplete() {
    if (!this.pendingCenter) return;
    const { fromFrame, plan } = this.pendingCenter;
    this.coreFrame = rotateFrame(fromFrame, plan.a, plan.b, plan.angle);  // commit
    this.centralCellIndex = centralFromFrame(this.coreFrame);
    this.pendingCenter = null;
  }

  toggleWire() { this.setWire(!this.showWire); }

  setWire(on) {
    this.showWire = on;
    const chk = document.getElementById('chk-wire');
    if (chk) chk.checked = on;
    this._setStatus(on ? 'Wireframe: on' : 'Wireframe: off');
  }

  executeMove(cellIndex, planeName, sign) {
    if (this.mode === 'demo') return;
    // Allow queuing up to 3 moves ahead; beyond that, wait for idle
    if (this.anim.moveQueue.length >= 3) return;
    this.anim.queueMove(this.cubies, cellIndex, planeName, sign);
    this.redoStack = [];
    this._updateUndoRedo();
  }

  _onMoveComplete(descriptor) {
    if (descriptor) {
      this.undoStack.push(descriptor);
      if (this.undoStack.length > 100) this.undoStack.shift();
      this._updateUndoRedo();
    }
    if (this.mode === 'demo') this.demo.onMoveComplete();
  }

  undo() {
    if (this.anim.isBusy() || this.undoStack.length === 0) return;
    const desc = this.undoStack.pop();
    undoMove(this.cubies, desc);
    this.redoStack.push(desc);
    this._updateUndoRedo();
  }

  redo() {
    if (this.anim.isBusy() || this.redoStack.length === 0) return;
    const desc = this.redoStack.pop();
    // Re-execute the move
    const { cellIndex, planeName, sign } = desc;
    this.anim.queueMove(this.cubies, cellIndex, planeName, sign);
    this._updateUndoRedo();
  }

  resetPuzzle() {
    if (this.mode === 'demo') this.stopDemo();
    this.anim.clearQueue();
    this.cubies = buildSolvedPuzzle();
    this.undoStack = [];
    this.redoStack = [];
    this._updateUndoRedo();
    this._setStatus('Puzzle reset');
    this._updateMoveCounter();
  }

  scramble() {
    if (this.mode === 'demo') return;
    if (this.anim.isBusy()) return;
    const CELLS_COUNT = 8;
    const planesPerCell = [
      ['YZ','YW','ZW'], ['YZ','YW','ZW'],
      ['XZ','XW','ZW'], ['XZ','XW','ZW'],
      ['XY','XW','YW'], ['XY','XW','YW'],
      ['XY','XZ','YZ'], ['XY','XZ','YZ'],
    ];
    for (let i = 0; i < 20; i++) {
      const ci = Math.floor(Math.random() * CELLS_COUNT);
      const planes = planesPerCell[ci];
      const plane = planes[Math.floor(Math.random() * planes.length)];
      const sign = Math.random() < 0.5 ? +1 : -1;
      this.anim.queueMove(this.cubies, ci, plane, sign);
    }
    this._setStatus('Scrambling…');
  }

  // ── Demo mode ────────────────────────────────────────────────────────────────

  startDemo() {
    this.resetPuzzle();
    this.mode = 'demo';
    document.getElementById('btn-regular').classList.remove('active');
    document.getElementById('btn-demo').classList.add('active');
    document.getElementById('demo-controls').classList.remove('hidden');
    this.demo.start(0);
    this._setStatus('Demo playing…');
  }

  stopDemo() {
    this.demo.stop();
    this.mode = 'regular';
    document.getElementById('btn-regular').classList.add('active');
    document.getElementById('btn-demo').classList.remove('active');
    document.getElementById('demo-controls').classList.add('hidden');
    this.anim.clearQueue();
    this._setStatus('Demo stopped');
    this._updateMoveCounter();
  }

  toggleDemoPlayPause() {
    if (this.mode !== 'demo') { this.startDemo(); return; }
    if (this.demo.playing) { this.demo.pause(); this._setStatus('Demo paused'); }
    else { this.demo.resume(); this._setStatus('Demo playing…'); }
  }

  demoPrev() {
    if (this.mode !== 'demo') return;
    this.demo.pause();
    this.demo.stepBackward();
    this._updateMoveCounter(this.demo.index + 1);
  }

  demoNext() {
    if (this.mode !== 'demo') return;
    if (this.anim.isBusy()) return;
    const move = this.demo.sequence[this.demo.index + 1];
    if (move) {
      this.demo.index++;
      this.demo.waitingForAnim = true;
      this.anim.queueMove(this.cubies, move.cellIndex, move.planeName, move.sign);
      this._updateMoveCounter(this.demo.index + 1);
    }
  }

  // ── UI binding ───────────────────────────────────────────────────────────────

  _bindUI() {
    document.getElementById('btn-regular').addEventListener('click', () => {
      if (this.mode === 'demo') this.stopDemo();
    });
    document.getElementById('btn-demo').addEventListener('click', () => {
      if (this.mode !== 'demo') this.startDemo();
    });
    document.getElementById('btn-reset-puzzle').addEventListener('click', () => this.resetPuzzle());
    document.getElementById('btn-reset-view').addEventListener('click', () => this.resetView());
    document.getElementById('btn-scramble').addEventListener('click', () => this.scramble());
    document.getElementById('chk-wire').addEventListener('change', e => this.setWire(e.target.checked));

    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());

    document.getElementById('btn-demo-play').addEventListener('click', () => {
      if (this.mode !== 'demo') this.startDemo();
      else { this.demo.resume(); this._setStatus('Demo playing…'); }
    });
    document.getElementById('btn-demo-pause').addEventListener('click', () => {
      this.demo.pause(); this._setStatus('Demo paused');
    });
    document.getElementById('btn-demo-stop').addEventListener('click', () => this.stopDemo());
    document.getElementById('btn-demo-prev').addEventListener('click', () => this.demoPrev());
    document.getElementById('btn-demo-next').addEventListener('click', () => this.demoNext());

    document.getElementById('speed-slider').addEventListener('input', e => {
      const v = parseInt(e.target.value);
      this.anim.speedFactor = v / 5; // 5 = 1x speed
    });

    document.getElementById('demo-loop').addEventListener('change', e => {
      this.demo.loop = e.target.checked;
    });

    for (const btn of document.querySelectorAll('[data-action]')) {
      btn.addEventListener('click', () => this._handleViewBtn(btn.dataset.action));
    }
  }

  _handleViewBtn(action) {
    const step = Math.PI / 18;
    switch(action) {
      case 'rotate-left':  this.orbit(-step, 0); break;
      case 'rotate-right': this.orbit( step, 0); break;
      case 'rotate-up':    this.orbit(0, -step); break;
      case 'rotate-down':  this.orbit(0,  step); break;
      case 'zoom-in':      this.zoomBy(1.15); break;
      case 'zoom-out':     this.zoomBy(1 / 1.15); break;
      case 'reset-view':   this.resetView(); break;
    }
  }

  _setStatus(msg) {
    document.getElementById('status-text').textContent = msg;
  }

  _updateUndoRedo() {
    document.getElementById('btn-undo').disabled = this.undoStack.length === 0;
    document.getElementById('btn-redo').disabled = this.redoStack.length === 0;
  }

  _updateMoveCounter(n = null) {
    const el = document.getElementById('move-index');
    if (n === null) el.textContent = '—';
    else el.textContent = `${n} / 48`;
  }
}

function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  try {
    window.__app = new App();
  } catch (e) {
    console.error('App failed to start:', e);
    document.body.innerHTML = `<div style="color:red;padding:20px;font-family:monospace">
      <b>Error starting app:</b><br>${e.message}<br><pre>${e.stack}</pre>
    </div>`;
  }
});
