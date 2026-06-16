import { mat3Mul, mat3AxisRotation } from './math4d.js';
import { buildSolvedPuzzle, undoMove, CELLS } from './puzzle.js';
import { computeCells, computeCellCube, computeWireframe, computeCoreWireframe,
         frameForCell, cloneFrame, slerpFrame, centralFromFrame } from './projection.js';
import { Renderer } from './renderer.js';
import { AnimationEngine } from './animation.js';
import { Controls, buildCellTiles, buildTurnControls, setCenteredTile, setControlSet } from './controls.js';

const AXIS_LETTERS = ['X', 'Y', 'Z', 'W'];   // 4D axis index → plane-name letter
const MAIN_CAM     = 15;                      // camera distance at zoom 1 (main view default)
const SUBVIEW_ZOOM = 2.4;                     // sub-views share the main camera distance and only
                                             // crop-zoom in to fill the tile (no distortion). Tuned
                                             // for zoom 1; sub-cubes scale with the main zoom.
const SHUFFLE_TURNS = 20;                      // moves per Shuffle
const SHUFFLE_SPEED = 2.0;                     // Shuffle always runs at full speed

class App {
  constructor() {
    this.cubies = buildSolvedPuzzle();
    this.centralCellIndex = 0;
    this.coreFrame = frameForCell(0);          // explicit 4D core orientation
    this.subFrames = CELLS.map((_, i) => frameForCell(i));   // fixed canonical frame per sub-view
    this.pendingCenter = null;                 // active centering { fromFrame, toFrame, toCi }
    this.viewMode = 'shell-wire';              // 'shell-wire' | 'total-wire' | 'semi'(disabled)
    this.controlSet = 'sides';                 // 'central' | 'sides' | 'both'

    // Turntable view: independent yaw/pitch so horizontal drag never leaks into roll.
    this.viewYaw   = -Math.PI / 5.5;
    this.viewPitch =  Math.PI / 7;
    this.viewZoom  = 1.0;
    this.viewRot = this._composeViewRot();

    this.undoStack = [];
    this.redoStack = [];

    this.anim = new AnimationEngine();
    this.anim.onMoveComplete = (desc) => this._onMoveComplete(desc);
    this.anim.onCentralComplete = () => this._onCentralComplete();

    this.shuffling = false;
    this.shuffleQueue = [];

    this.dirty = true;                         // redraw flag (render only when needed)

    this.canvas = document.getElementById('glcanvas');
    this.renderer = new Renderer(this.canvas);
    this.stageEl = document.getElementById('stage');

    buildCellTiles();
    buildTurnControls(this);
    setControlSet(this.controlSet);
    this.tileEls = [];
    document.querySelectorAll('.cell-tile').forEach(el => { this.tileEls[+el.dataset.cell] = el; });
    setCenteredTile(this.centralCellIndex);

    this.controls = new Controls(this.canvas, this);
    this._bindUI();

    window.addEventListener('resize', () => this.markDirty());
    window.addEventListener('orientationchange', () => this.markDirty());
    // iOS Safari ignores user-scalable=no, so block its pinch gesture from zooming the
    // page (we handle zoom on the canvas ourselves; double-tap zoom is off via touch-action).
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, e => e.preventDefault(), { passive: false });
    }

    requestAnimationFrame(ts => this._loop(ts));
  }

  markDirty() { this.dirty = true; }

  // ── Render loop ──────────────────────────────────────────────────────────────

  _loop(timestamp) {
    if (this.shuffling && this.anim.isIdle()) this._shuffleStep();

    const frame = this.anim.tick(timestamp, this.cubies, this.centralCellIndex);

    const busy = !this.anim.isIdle() || !!this.pendingCenter || this.shuffling;
    if (this.dirty || busy) {
      this._render(frame);
      this.dirty = false;
    }
    requestAnimationFrame(ts => this._loop(ts));
  }

  _render(frame) {
    // Core frame for this instant (interpolated during a centering animation).
    let coreFrame = this.coreFrame;
    if (frame && frame.type === 'central' && this.pendingCenter) {
      coreFrame = slerpFrame(this.pendingCenter.fromFrame, this.pendingCenter.toFrame, easeInOut(frame.t));
    }
    const getState = frame && frame.type === 'move' ? frame.getState : null;

    // Main view geometry.
    let cells, segments;
    if (this.viewMode === 'total-wire') {
      cells = [];
      const spinCell = frame && frame.type === 'move' ? frame.cellIndex : -1;
      const spinR    = frame && frame.type === 'move' ? frame.R : null;
      segments = computeWireframe(this.cubies, coreFrame, getState)
        .concat(computeCoreWireframe(coreFrame, [0, 1, 2, 3, 4, 5, 6, 7], spinCell, spinR));
    } else {
      cells = computeCells(this.cubies, coreFrame, getState);
      segments = computeWireframe(this.cubies, coreFrame, getState, true);
    }

    const r = this.renderer;
    const canvasRect = this.canvas.getBoundingClientRect();
    r.beginFrame();
    const H = this.canvas.height, dpr = window.devicePixelRatio || 1;
    const rectOf = el => this._glRect(el, canvasRect, dpr, H);

    // Main tesseract view.
    const camDist = MAIN_CAM / this.viewZoom;
    r.drawView(cells, this.viewRot, segments, camDist, rectOf(this.stageEl));
    // 8 cell sub-views — each cell as a solid Rubik's cube, sharing the same viewRot AND the
    // same camera distance as the main view (so identical perspective), cropped to fill the tile.
    for (let i = 0; i < 8; i++) {
      const sub = computeCellCube(this.cubies, i, this.subFrames[i], getState);
      r.drawView(sub, this.viewRot, null, camDist, rectOf(this.tileEls[i]), SUBVIEW_ZOOM);
    }
  }

  // DOM element → GL device-pixel rect (origin bottom-left), relative to the canvas.
  _glRect(el, canvasRect, dpr, H) {
    const b = el.getBoundingClientRect();
    const w = Math.round(b.width * dpr), h = Math.round(b.height * dpr);
    const x = Math.round((b.left - canvasRect.left) * dpr);
    const y = H - Math.round((b.top - canvasRect.top) * dpr) - h;
    return { x, y, w, h };
  }

  // ── View ─────────────────────────────────────────────────────────────────────

  _composeViewRot() {
    return mat3Mul(mat3AxisRotation(0, this.viewPitch), mat3AxisRotation(1, this.viewYaw));
  }

  orbit(dYaw, dPitch) {
    const maxPitch = Math.PI / 2;
    this.viewYaw += dYaw;
    this.viewPitch = Math.max(-maxPitch, Math.min(maxPitch, this.viewPitch + dPitch));
    this.viewRot = this._composeViewRot();
    this.markDirty();
  }

  zoomBy(factor) {
    this.viewZoom = Math.max(0.5, Math.min(2.2, this.viewZoom * factor));
    this.markDirty();
  }

  resetView() {
    this.viewYaw = -Math.PI / 5.5;
    this.viewPitch = Math.PI / 7;
    this.viewZoom = 1.0;
    this.viewRot = this._composeViewRot();
    this.markDirty();
  }

  // ── Centering (stable: always commits the destination's canonical frame) ──────

  selectCentralCell(cellIndex) {
    if (this.anim.isBusy()) return;
    if (cellIndex === this.centralCellIndex && !this.pendingCenter) return;
    this.pendingCenter = {
      fromFrame: cloneFrame(this.coreFrame),
      toFrame: frameForCell(cellIndex),
      toCi: cellIndex,
    };
    this.anim.queueCentralCell(this.centralCellIndex, cellIndex);
    this.centralCellIndex = cellIndex;
    setCenteredTile(cellIndex);
    this.markDirty();
  }

  _onCentralComplete() {
    if (!this.pendingCenter) return;
    this.coreFrame = this.pendingCenter.toFrame;     // commit the exact canonical frame
    this.centralCellIndex = centralFromFrame(this.coreFrame);
    this.pendingCenter = null;
    this.markDirty();
  }

  // ── Turns (only the centred cell; mapped from a screen-plane button) ──────────

  // A twist button names a screen-plane via two indices into the core frame basis
  // (e0→x, e1→y, e2→z) and a direction. Resolve it to the centred cell's concrete
  // (planeName, sign) using its canonical frame, so the on-screen spin matches the
  // icon's arrow regardless of which cell is centred.
  turnScreenPlane(iIdx, jIdx, dir) {
    if (this.anim.isBusy()) return;
    const f = frameForCell(this.centralCellIndex);
    const { planeName, sign } = this._screenPlaneMove(f, iIdx, jIdx, dir);
    this.executeMove(this.centralCellIndex, planeName, sign);
  }

  // Rotate a FACE-LAYER of the central cube — i.e. turn the SIDE CELL on that face,
  // the same move family the shuffle uses. `kScreen` is the face-normal screen axis
  // (0/1/2 ↔ e0/e1/e2), `sSide` ±1 which of the two faces. The turn plane is the other
  // two screen axes (so it avoids the depth axis — a clean Rubik's face turn).
  turnFace(kScreen, sSide, dir) {
    if (this.anim.isBusy()) return;
    const f = frameForCell(this.centralCellIndex);
    const eN = f.e[kScreen];
    const fAxis = nonzeroAxis(eN);
    const ci = CELLS.findIndex(c => c.axis === fAxis && c.val === sSide * Math.sign(eN[fAxis]));
    const [i, j] = [0, 1, 2].filter(k => k !== kScreen);
    const { planeName, sign } = this._screenPlaneMove(f, i, j, dir);
    this.executeMove(ci, planeName, sign);
  }

  // Map a screen-plane (the two screen axes iIdx,jIdx) under frame `f` to a concrete 4D
  // (planeName, sign). `dir=+1` is a right-handed CCW turn about the THIRD screen axis
  // e[k] (k = the missing index), so it matches the icon's arrow. `par` is the parity of
  // (iIdx,jIdx,k): the (0,2) plane is cyclically odd, so without it the Y axis (yaw /
  // top-bottom faces) would come out inverted relative to roll/pitch.
  _screenPlaneMove(f, iIdx, jIdx, dir) {
    const ei = f.e[iIdx], ej = f.e[jIdx];
    const p = nonzeroAxis(ei), si = Math.sign(ei[p]);
    const q = nonzeroAxis(ej), sj = Math.sign(ej[q]);
    const a = Math.min(p, q), b = Math.max(p, q);
    const k = 3 - iIdx - jIdx;
    const par = Math.sign((jIdx - iIdx) * (k - iIdx) * (k - jIdx));
    return { planeName: AXIS_LETTERS[a] + AXIS_LETTERS[b], sign: dir * (p < q ? 1 : -1) * si * sj * par };
  }

  // Turn the MIDDLE layer of the central cube along screen axis `kScreen` (a true
  // middle slice — only the centred cube's middle ring moves; see executeMiddleMove).
  turnMiddle(kScreen, dir) {
    if (this.anim.isBusy() || this.anim.moveQueue.length >= 3) return;
    const f = frameForCell(this.centralCellIndex);
    const fAxis = nonzeroAxis(f.e[kScreen]);
    const [i, j] = [0, 1, 2].filter(x => x !== kScreen);
    const { planeName, sign } = this._screenPlaneMove(f, i, j, dir);
    this.anim.queueMiddle(this.cubies, this.centralCellIndex, fAxis, planeName, sign);
    this.redoStack = [];
    this.markDirty();
  }

  executeMove(cellIndex, planeName, sign) {
    if (this.anim.moveQueue.length >= 3) return;   // queue up to 3 ahead
    this.anim.queueMove(this.cubies, cellIndex, planeName, sign);
    this.redoStack = [];
    this.markDirty();
  }

  _onMoveComplete(descriptor) {
    if (descriptor) {
      this.undoStack.push(descriptor);
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.markDirty();
  }

  undo() {
    if (this.anim.isBusy() || this.undoStack.length === 0) return;
    const desc = this.undoStack.pop();
    undoMove(this.cubies, desc);
    this.redoStack.push(desc);
    this.markDirty();
  }

  redo() {
    if (this.anim.isBusy() || this.redoStack.length === 0) return;
    const desc = this.redoStack.pop();
    if (desc.type === 'middle') this.anim.queueMiddle(this.cubies, desc.centralCellIndex, desc.fAxis, desc.planeName, desc.sign);
    else this.anim.queueMove(this.cubies, desc.cellIndex, desc.planeName, desc.sign);
    this.markDirty();
  }

  resetPuzzle() {
    this._endShuffle();
    this.anim.clearQueue();
    this.cubies = buildSolvedPuzzle();
    this.undoStack = [];
    this.redoStack = [];
    this.markDirty();
  }

  // Solved = every cubie home (pos4 === solvedPos4) with identity orientation. The
  // frame/central cell doesn't matter — a solved puzzle reads solved from any cell.
  isSolved() {
    return this.cubies.every(c =>
      c.pos4.every((v, i) => v === c.solvedPos4[i]) &&
      c.orient.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6));
  }

  // ── Shuffle (one-shot, fixed count, full speed) ──────────────────────────────

  shuffle() {
    if (this.anim.isBusy() || this.shuffling) return;
    this.shuffleQueue = this._planShuffle(SHUFFLE_TURNS);
    this.shuffling = true;
    this._prevSpeed = this.anim.speedFactor;
    this.anim.speedFactor = SHUFFLE_SPEED;
    this.markDirty();
  }

  _endShuffle() {
    if (!this.shuffling) return;
    this.shuffling = false;
    this.shuffleQueue = [];
    if (this._prevSpeed != null) { this.anim.speedFactor = this._prevSpeed; this._prevSpeed = null; }
    this.markDirty();
  }

  _shuffleStep() {
    const act = this.shuffleQueue.shift();
    if (!act) { this._endShuffle(); return; }
    if (act.type === 'move') this.anim.queueMove(this.cubies, act.cellIndex, act.plane, act.sign);
    else this.selectCentralCell(act.cellIndex);
  }

  // Build the full shuffle plan up front: rounds of 3–7 clean side-cell turns (never
  // depth-involving) on the current centre, recentering to a different cell between
  // rounds — the original scramble algorithm, bounded to ~n turns.
  _planShuffle(n) {
    const actions = [];
    let central = this.centralCellIndex, last = null, made = 0;
    while (made < n) {
      const roundLen = Math.min(3 + Math.floor(Math.random() * 5), n - made);
      const others = [0, 1, 2, 3].filter(a => a !== CELLS[central].axis);
      for (let i = 0; i < roundLen; i++) {
        let mv;
        do {
          const axis = others[Math.floor(Math.random() * 3)];
          const cellVal = Math.random() < 0.5 ? 1 : -1;
          const cellIndex = CELLS.findIndex(c => c.axis === axis && c.val === cellVal);
          const [p, q] = others.filter(a => a !== axis);
          mv = { type: 'move', cellIndex, plane: AXIS_LETTERS[p] + AXIS_LETTERS[q],
                 sign: Math.random() < 0.5 ? 1 : -1 };
        } while (last && mv.cellIndex === last.cellIndex && mv.plane === last.plane && mv.sign === -last.sign);
        last = mv; actions.push(mv); made++;
      }
      if (made < n) {
        let next = central; while (next === central) next = Math.floor(Math.random() * 8);
        actions.push({ type: 'center', cellIndex: next });
        central = next; last = null;
      }
    }
    return actions;
  }

  // ── View mode ────────────────────────────────────────────────────────────────

  setViewMode(mode) {
    if (mode === 'semi') return;               // placeholder, disabled
    this.viewMode = mode;
    const radio = document.querySelector(`input[name="viewmode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    this.markDirty();
  }

  cycleViewMode() {
    this.setViewMode(this.viewMode === 'shell-wire' ? 'total-wire' : 'shell-wire');
  }

  setControlSet(set) {
    this.controlSet = set;
    setControlSet(set);                        // module helper: show/hide the button groups
  }

  // ── UI binding ───────────────────────────────────────────────────────────────

  _bindUI() {
    const menu = document.getElementById('menu-overlay');
    const confirm = document.getElementById('confirm-overlay');
    const show = el => el.classList.remove('hidden');
    const hide = el => el.classList.add('hidden');

    document.getElementById('menu-button').addEventListener('click', () => show(menu));
    document.getElementById('menu-close').addEventListener('click', () => hide(menu));
    menu.addEventListener('click', e => { if (e.target === menu) hide(menu); });

    // Shared confirm dialog: only prompt when there's progress to lose (puzzle not
    // solved); otherwise run the action straight away.
    const confirmP = confirm.querySelector('p');
    const confirmOk = document.getElementById('confirm-ok');
    const guard = (msg, okLabel, action) => {
      if (this.isSolved()) { action(); return; }
      confirmP.textContent = msg;
      confirmOk.textContent = okLabel;
      this._confirmAction = action;
      show(confirm);
    };

    document.getElementById('btn-shuffle').addEventListener('click', () => {
      hide(menu);
      guard('Shuffle the puzzle? Your current progress will be lost.', 'Shuffle', () => this.shuffle());
    });
    document.getElementById('btn-reset').addEventListener('click', () => {
      hide(menu);
      guard("Reset the puzzle to solved? This can't be undone.", 'Reset', () => this.resetPuzzle());
    });

    document.getElementById('confirm-cancel').addEventListener('click', () => hide(confirm));
    confirmOk.addEventListener('click', () => { hide(confirm); if (this._confirmAction) this._confirmAction(); });
    confirm.addEventListener('click', e => { if (e.target === confirm) hide(confirm); });

    document.getElementById('speed-slider').addEventListener('input', e => {
      this.anim.speedFactor = parseInt(e.target.value) / 5;   // 5 = 1×
    });
    for (const radio of document.querySelectorAll('input[name="viewmode"]')) {
      radio.addEventListener('change', e => { if (e.target.checked) this.setViewMode(e.target.value); });
    }
    for (const radio of document.querySelectorAll('input[name="controlset"]')) {
      radio.addEventListener('change', e => { if (e.target.checked) this.setControlSet(e.target.value); });
    }
  }
}

function nonzeroAxis(v) {
  let k = 0, best = 0;
  for (let i = 0; i < 4; i++) if (Math.abs(v[i]) > best) { best = Math.abs(v[i]); k = i; }
  return k;
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
