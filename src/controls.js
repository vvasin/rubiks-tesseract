// Input handling + DOM builders for the game shell.
//   • One pointer handler on the canvas: drag anywhere orbits all 9 synchronized
//     views; a tap on a cell sub-view tile centres that cell; two fingers pinch-zoom.
//   • Builds the 8 cell tiles and the 6 embedded twist buttons.
import { CELLS } from './puzzle.js';
import { TURN_BUTTONS, turnIcon, faceIcon, middleIcon } from './icons.js';

const VIEW_STEP = Math.PI / 36;   // per arrow-key press
const ZOOM_STEP = 1.0015;         // per wheel-delta unit
const TAP_SLOP  = 10;             // px of movement still counted as a tap (not a drag)

export class Controls {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.pointers = new Map();     // active pointerId → {x, y}
    this.pinchDist = null;
    this.down = null;              // {x, y, moved, cell} for tap/drag tracking
    this._bindCanvas();
    this._bindKeyboard();
  }

  // Which cell tile (if any) is under a client point. Tiles are pointer-events:none,
  // so we hit-test their rectangles ourselves.
  _tileAt(x, y) {
    for (const el of document.querySelectorAll('.cell-tile')) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return +el.dataset.cell;
    }
    return -1;
  }

  _bindCanvas() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._onDown(e));
    c.addEventListener('pointermove', e => this._onMove(e));
    c.addEventListener('pointerup',   e => this._onUp(e));
    c.addEventListener('pointercancel', e => this._onUp(e));
    c.addEventListener('wheel', e => {
      this.app.zoomBy(Math.pow(ZOOM_STEP, -e.deltaY));
      e.preventDefault();
    }, { passive: false });
  }

  _onDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.pinchDist = this._pinchDist();
      this.down = null;                    // a second finger cancels the tap/drag
    } else {
      this.down = { x: e.clientX, y: e.clientY, moved: false, cell: this._tileAt(e.clientX, e.clientY) };
    }
    e.preventDefault();
  }

  _onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (this.pointers.size >= 2) {
      const d = this._pinchDist();
      if (this.pinchDist) this.app.zoomBy(d / this.pinchDist);
      this.pinchDist = d;
      return;
    }
    if (!this.down) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > TAP_SLOP) this.down.moved = true;
    this.app.orbit(dx * 0.008, dy * 0.008);
    e.preventDefault();
  }

  _onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = null;
    const d = this.down;
    this.down = null;
    if (d && !d.moved && d.cell >= 0) this.app.selectCentralCell(d.cell);
  }

  _pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', e => this._onKey(e));
  }

  _onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8':
        this.app.selectCentralCell(parseInt(e.key) - 1); break;
      case 'ArrowLeft':  this.app.orbit(-VIEW_STEP, 0); e.preventDefault(); break;
      case 'ArrowRight': this.app.orbit( VIEW_STEP, 0); e.preventDefault(); break;
      case 'ArrowUp':    this.app.orbit(0, -VIEW_STEP); e.preventDefault(); break;
      case 'ArrowDown':  this.app.orbit(0,  VIEW_STEP); e.preventDefault(); break;
      case 'r': case 'R': this.app.resetPuzzle(); break;
      case 'v': case 'V': this.app.resetView(); break;
      case 'w': case 'W': this.app.cycleViewMode(); break;
      case 'u': case 'U': e.shiftKey ? this.app.redo() : this.app.undo(); break;
    }
  }
}

// Build the 8 cell tiles into the top/bottom strips (cells 0–3 top, 4–7 bottom).
export function buildCellTiles() {
  const top = document.getElementById('cells-top');
  const bottom = document.getElementById('cells-bottom');
  top.innerHTML = ''; bottom.innerHTML = '';
  CELLS.forEach((cell, i) => {
    const tile = document.createElement('div');
    tile.className = 'cell-tile';
    tile.dataset.cell = i;
    tile.style.setProperty('--cell', rgbToHex(cell.color));
    tile.innerHTML = `<span class="tile-name">${cell.name}</span>`;
    (i < 4 ? top : bottom).appendChild(tile);
  });
}

// Mark the centred cell's tile.
export function setCenteredTile(idx) {
  document.querySelectorAll('.cell-tile').forEach(el => {
    el.classList.toggle('centered', +el.dataset.cell === idx);
  });
}

// One layer-turn button for axis k: outer slabs → turnFace, middle slab → turnMiddle.
function slabBtn(app, k, slab, dir) {
  if (slab === 'mid') return { html: middleIcon(k, dir), fn: () => app.turnMiddle(k, dir) };
  const s = slab === 'top' ? +1 : -1;
  return { html: faceIcon(k, s, dir), fn: () => app.turnFace(k, s, dir) };
}

// The 6 layer-turn buttons (3 slabs × 2 dirs) for one axis, ordered for the grid:
// 'h' = 3 cols (dir-major rows: + then −); 'v' = 2 cols (slab-major rows).
function slabButtons(app, k, orient) {
  const slabs = ['top', 'mid', 'bot'], dirs = [+1, -1], out = [];
  if (orient === 'h') for (const d of dirs) for (const s of slabs) out.push(slabBtn(app, k, s, d));
  else                for (const s of slabs) for (const d of dirs) out.push(slabBtn(app, k, s, d));
  return out;
}

function fillGroup(id, set, cls, buttons) {
  const g = document.getElementById(id);
  g.className = `turn-group ${cls}`;
  g.dataset.set = set;
  g.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'turn-btn';
    el.innerHTML = b.html;
    el.addEventListener('click', b.fn);
    g.appendChild(el);
  }
}

// Build the 4 twist-button groups framing the cube: bottom = whole-cube rotation;
// top/left/right = per-axis layer turns (top/middle/bottom slab × 2 dirs).
export function buildTurnControls(app) {
  fillGroup('turn-bottom', 'central', 'grid-3col',
    TURN_BUTTONS.map(b => ({ html: turnIcon(b.key, b.dir), fn: () => app.turnScreenPlane(b.iIdx, b.jIdx, b.dir) })));
  fillGroup('turn-top',   'sides', 'grid-3col', slabButtons(app, 1, 'h'));  // screen Y axis
  fillGroup('turn-left',  'sides', 'grid-2col', slabButtons(app, 0, 'v'));  // screen X axis
  fillGroup('turn-right', 'sides', 'grid-2col', slabButtons(app, 2, 'v'));  // screen Z axis
}

// Show the chosen control set(s): 'central' (bottom) | 'sides' (top/left/right) | 'both'.
export function setControlSet(set) {
  document.querySelectorAll('.turn-group').forEach(g => {
    g.classList.toggle('hidden', !(set === 'both' || g.dataset.set === set));
  });
}

function rgbToHex([r, g, b]) {
  const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
