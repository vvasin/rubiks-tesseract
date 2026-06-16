import { mat3Mul, mat3AxisRotation, mat3MulVec3 } from './math4d.js';
import { buildSolvedPuzzle, undoMove, CELLS, serializeCubies, restoreCubies } from './puzzle.js';
import { readState, writeState, debounce } from './persistence.js';
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
const SAVE_DEBOUNCE = 500;                     // ms to coalesce persistence writes
const VIEW_MODES    = ['shell-wire', 'total-wire'];
const CONTROL_SETS  = ['central', 'sides', 'both', 'none'];   // 'none' = zen mode (no buttons)

// Direct-manipulation swipe (turn the centred cube by dragging across its stickers).
// A central-cell cubie always projects to a clean grid: pos4·eF = 1 → depthR(1) = 1.35
// constant, so its free-axis coords land at (g·1.35) along screen x/y/z. We model the
// centred 3×3×3 as that idealized cube and project it through the renderer's exact camera.
const STICKER_GRID  = 1.35;                  // central-cube cubie spacing in projected 3D
const STICKER_HALF  = STICKER_GRID / 2;      // half a cell → stickers tile continuously
const STICKER_FOV   = Math.PI / 3.2;         // must match renderer's perspective FOV
const MIN_STICKER_FRAC = 0.0006;             // drop stickers smaller than this fraction of the
                                             // main-view area (edge-on / heavily foreshortened);
                                             // ~0.0006 keeps all 27 readable at rest, dropping only
                                             // slivers as a face turns toward edge-on

const isCellIndex = v => Number.isInteger(v) && v >= 0 && v < 8;

class App {
  constructor() {
    // Restore the previous session (puzzle, central cell, settings) if one was saved.
    const saved = readState();

    this.cubies = buildSolvedPuzzle();
    if (saved && !restoreCubies(this.cubies, saved.cubies)) this.cubies = buildSolvedPuzzle();
    this.centralCellIndex = isCellIndex(saved?.central) ? saved.central : 0;
    this.coreFrame = frameForCell(this.centralCellIndex);    // explicit 4D core orientation
    this.subFrames = CELLS.map((_, i) => frameForCell(i));   // fixed canonical frame per sub-view
    this.pendingCenter = null;                 // active centering { fromFrame, toFrame, toCi }
    this.viewMode = VIEW_MODES.includes(saved?.viewMode) ? saved.viewMode : 'shell-wire';
    this.controlSet = CONTROL_SETS.includes(saved?.controlSet) ? saved.controlSet : 'central';

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
    this._restoreSettingsUI(saved);

    // Persistence: debounced writes coalesce bursts of turns / a shuffle into one save,
    // and a pagehide flush captures the last move before the tab is backgrounded/closed.
    this._scheduleSave = debounce(() => writeState(this._serialize()), SAVE_DEBOUNCE);
    window.addEventListener('pagehide', () => this._scheduleSave.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._scheduleSave.flush();
    });

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
    this._scheduleSave?.();
    this.markDirty();
  }

  _onCentralComplete() {
    if (!this.pendingCenter) return;
    this.coreFrame = this.pendingCenter.toFrame;     // commit the exact canonical frame
    this.centralCellIndex = centralFromFrame(this.coreFrame);
    this.pendingCenter = null;
    this._scheduleSave?.();
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

  // ── Direct manipulation: swipe across the centred cube to turn a layer ─────────

  // The interaction surface: up to 27 sticker quads of the centred 3×3×3, projected to
  // CLIENT pixels through the renderer's exact camera (so it tracks orientation + zoom).
  // Each sticker carries its grid coord `g` (∈{-1,0,1}³ along screen x/y/z), the face it
  // lives on (axis `a`, sign `sa`), the two in-face tangent axes `t`, and its screen depth
  // `zc` (smaller = nearer). Back-facing and heavily-foreshortened faces are dropped, so a
  // swipe only ever lands on a clearly-visible sticker. Returns [] while busy (no geometry
  // to twist mid-animation) — the caller then falls back to orbiting.
  centralStickers() {
    if (this.anim.isBusy() || this.pendingCenter) return [];
    const rect = this.stageEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return [];
    const aspect = rect.width / rect.height;
    const fcam = 1 / Math.tan(STICKER_FOV / 2);
    const camDist = MAIN_CAM / this.viewZoom;
    const R = this.viewRot;
    const proj = (p) => {
      const w = mat3MulVec3(R, p);
      const inv = 1 / (camDist - w[2]);                 // perspective divide (clip.w = camDist − z)
      return {
        x: rect.left + (fcam / aspect * w[0] * inv * 0.5 + 0.5) * rect.width,
        y: rect.top  + (0.5 - fcam * w[1] * inv * 0.5) * rect.height,
        zc: camDist - w[2],
      };
    };
    const minArea = rect.width * rect.height * MIN_STICKER_FRAC;
    const out = [];
    for (let a = 0; a < 3; a++) for (const sa of [1, -1]) {
      const [t0, t1] = [0, 1, 2].filter(x => x !== a);
      const nWorld = mat3MulVec3(R, axisVec(a, sa));    // face normal, view-rotated
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
        const g = [0, 0, 0]; g[a] = sa; g[t0] = u; g[t1] = v;
        const fc = [g[0] * STICKER_GRID, g[1] * STICKER_GRID, g[2] * STICKER_GRID];
        fc[a] += sa * STICKER_HALF;                     // out to the cube surface
        const cWorld = mat3MulVec3(R, fc);
        const toCam = [-cWorld[0], -cWorld[1], camDist - cWorld[2]];
        if (nWorld[0]*toCam[0] + nWorld[1]*toCam[1] + nWorld[2]*toCam[2] <= 0) continue;  // back-facing
        const poly = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([du, dv]) => {
          const c = fc.slice(); c[t0] += du * STICKER_HALF; c[t1] += dv * STICKER_HALF;
          return proj(c);
        });
        if (polyArea2(poly) < minArea) continue;        // edge-on / too small to target
        out.push({ g, a, sa, t: [t0, t1], poly, zc: proj(fc).zc });
      }
    }
    return out;
  }

  // Resolve a swipe into a layer turn from the start sticker plus the point `(x, y)` the
  // finger has reached — specifically, which EDGE of the start sticker the swipe exits
  // through. That single piece of information is enough and sidesteps two awkward cases of
  // a "two-sticker" scheme: a swipe that wraps over a cube edge onto another face of the
  // same cubie, and one that runs off into empty space — both still classify cleanly.
  //
  // We express the displacement from the sticker centre in the sticker's own in-face
  // tangent basis (read perspective-correctly off its projected quad): components `a0`,`a1`
  // along +t0,+t1 in cell units. The dominant one is the drag axis; the OTHER tangent is the
  // rotation axis; `start`'s coord along it is the slab; its sign fixes the turn direction so
  // the grabbed sticker travels the way the finger went. Returns true iff a turn was issued.
  applyCentralSwipe(start, x, y) {
    const [t0, t1] = start.t, c = start.poly;
    const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
    const cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
    // Screen-space directions of +t0 and +t1 (opposite edge midpoints of the quad).
    const ux = (c[1].x + c[2].x - c[0].x - c[3].x) / 2, uy = (c[1].y + c[2].y - c[0].y - c[3].y) / 2;
    const vx = (c[2].x + c[3].x - c[0].x - c[1].x) / 2, vy = (c[2].y + c[3].y - c[0].y - c[1].y) / 2;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-6) return false;
    const dx = x - cx, dy = y - cy;
    const a0 = (dx * vy - dy * vx) / det;     // exit component along +t0
    const a1 = (ux * dy - uy * dx) / det;     // exit component along +t1
    const useT0 = Math.abs(a0) >= Math.abs(a1);
    const delta = Math.sign(useT0 ? a0 : a1);
    if (!delta) return false;
    const tIdx = useT0 ? t0 : t1;             // axis the drag ran along
    const r    = useT0 ? t1 : t0;             // rotation axis = the other tangent
    const cr = cross3v(axisVec(r, 1), axisVec(start.a, start.sa));   // r̂ × n̂: the face's drift dir
    const dir = delta * Math.sign(cr[tIdx]);
    const slab = start.g[r];
    if (slab === 0) this.turnMiddle(r, dir);
    else this.turnFace(r, slab, dir);
    return true;
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
    this._scheduleSave?.();
    this.markDirty();
  }

  undo() {
    if (this.anim.isBusy() || this.undoStack.length === 0) return;
    const desc = this.undoStack.pop();
    undoMove(this.cubies, desc);
    this.redoStack.push(desc);
    this._scheduleSave?.();
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
    this._scheduleSave?.();
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
    this._scheduleSave?.();
    this.markDirty();
  }

  cycleViewMode() {
    this.setViewMode(this.viewMode === 'shell-wire' ? 'total-wire' : 'shell-wire');
  }

  setControlSet(set) {
    this.controlSet = set;
    setControlSet(set);                        // module helper: show/hide the button groups
    this._scheduleSave?.();
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  // Snapshot of everything that should outlive a refresh: the puzzle (mutable cubie
  // fields), the centred cell, and the menu settings. View orientation is deliberately
  // not persisted — it's transient, and resetting it on reload feels natural.
  _serialize() {
    return {
      cubies: serializeCubies(this.cubies),
      central: this.centralCellIndex,
      viewMode: this.viewMode,
      controlSet: this.controlSet,
      speed: parseInt(document.getElementById('speed-slider').value),
    };
  }

  // Reflect restored settings into the menu controls (and the animation speed). The puzzle,
  // central cell, view mode and control set were already applied in the constructor; this
  // only syncs the on-screen inputs and the speed factor.
  _restoreSettingsUI(saved) {
    const setRadio = (name, value) => {
      const r = document.querySelector(`input[name="${name}"][value="${value}"]`);
      if (r) r.checked = true;
    };
    setRadio('viewmode', this.viewMode);
    setRadio('controlset', this.controlSet);

    const slider = document.getElementById('speed-slider');
    const speed = saved?.speed;
    if (Number.isInteger(speed) && speed >= +slider.min && speed <= +slider.max) {
      slider.value = speed;
      this.anim.speedFactor = speed / 5;
    }
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
      this._scheduleSave?.();
    });
    for (const radio of document.querySelectorAll('input[name="viewmode"]')) {
      radio.addEventListener('change', e => { if (e.target.checked) this.setViewMode(e.target.value); });
    }
    for (const radio of document.querySelectorAll('input[name="controlset"]')) {
      radio.addEventListener('change', e => { if (e.target.checked) this.setControlSet(e.target.value); });
    }
  }
}

// A signed unit 3-vector along one screen axis.
function axisVec(axis, sign) { const v = [0, 0, 0]; v[axis] = sign; return v; }

function cross3v(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}

// Twice the signed area of a screen polygon (shoelace) — magnitude only, for thresholding.
function polyArea2(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
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
