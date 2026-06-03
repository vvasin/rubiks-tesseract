// Input handling: mouse drag, keyboard, UI buttons
import { CELLS, getCellPlanes } from './puzzle.js';

const VIEW_STEP = Math.PI / 36; // per arrow-key press
const ZOOM_STEP = 1.0015;       // per wheel-delta unit

export class Controls {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.drag = null;
    this._bindCanvas();
    this._bindKeyboard();
  }

  _bindCanvas() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => this._onMouseDown(e));
    c.addEventListener('mousemove', e => this._onMouseMove(e));
    c.addEventListener('mouseup',   () => this._onMouseUp());
    c.addEventListener('mouseleave', () => this._onMouseUp());
    // Mouse wheel → zoom (trackpad scroll also lands here).
    c.addEventListener('wheel', e => {
      this.app.zoomBy(Math.pow(ZOOM_STEP, -e.deltaY));
      e.preventDefault();
    }, { passive: false });
    // Touch support: 1 finger orbits, 2 fingers pinch-zoom.
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 2) { this.pinchDist = this._touchDist(e); this.drag = null; }
      else { const t = e.touches[0]; this._onMouseDown({ clientX: t.clientX, clientY: t.clientY }); }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        const d = this._touchDist(e);
        if (this.pinchDist) this.app.zoomBy(d / this.pinchDist);
        this.pinchDist = d;
      } else {
        const t = e.touches[0];
        this._onMouseMove({ clientX: t.clientX, clientY: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchend', e => { if (e.touches.length === 0) { this._onMouseUp(); this.pinchDist = null; } });
  }

  _touchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  _onMouseDown(e) {
    this.drag = { x: e.clientX, y: e.clientY };
  }

  _onMouseMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag = { x: e.clientX, y: e.clientY };

    const sensitivity = 0.008;
    // Horizontal drag → yaw, vertical drag → pitch. Decoupled, so no roll.
    this.app.orbit(dx * sensitivity, dy * sensitivity);
  }

  _onMouseUp() {
    this.drag = null;
  }

  _bindKeyboard() {
    window.addEventListener('keydown', e => this._onKey(e));
  }

  _onKey(e) {
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8':
        this.app.selectCentralCell(parseInt(e.key) - 1);
        break;
      case 'ArrowLeft':
        this.app.orbit(-VIEW_STEP, 0);
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.app.orbit(VIEW_STEP, 0);
        e.preventDefault();
        break;
      case 'ArrowUp':
        this.app.orbit(0, -VIEW_STEP);
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.app.orbit(0, VIEW_STEP);
        e.preventDefault();
        break;
      case 'r': case 'R':
        this.app.resetPuzzle();
        break;
      case 'v': case 'V':
        this.app.resetView();
        break;
      case 'w': case 'W':
        this.app.toggleWire();
        break;
      case ' ':
        this.app.toggleDemoPlayPause();
        e.preventDefault();
        break;
      case 'Escape':
        this.app.stopDemo();
        break;
      case 'd': case 'D':
        this.app.startDemo();
        break;
      case 's': case 'S':
        if (!e.shiftKey) this.app.scramble();
        break;
      case 'u': case 'U':
        if (e.shiftKey) this.app.redo();
        else this.app.undo();
        break;
    }
  }
}

// Build the cell control panel HTML and wire up buttons
export function buildCellPanel(panelEl, app) {
  const scroll = panelEl.querySelector('.panel-scroll');
  scroll.innerHTML = '';

  CELLS.forEach((cell, cellIndex) => {
    const planes = getCellPlanes(cellIndex);
    const colorHex = rgbToHex(cell.color);

    const group = document.createElement('div');
    group.className = 'cell-group';
    group.dataset.cellIndex = cellIndex;

    const header = document.createElement('div');
    header.className = 'cell-header';
    header.innerHTML = `
      <span class="cell-color-dot" style="background:${colorHex}"></span>
      <span class="cell-name">Cell ${cell.name}</span>
      <span class="cell-central-badge" style="display:none">●</span>
    `;
    header.addEventListener('click', () => app.selectCentralCell(cellIndex));

    const body = document.createElement('div');
    body.className = 'cell-body';

    const centralBtn = document.createElement('button');
    centralBtn.className = 'cell-use-central';
    centralBtn.textContent = 'Use as Central';
    centralBtn.addEventListener('click', e => {
      e.stopPropagation();
      app.selectCentralCell(cellIndex);
    });
    body.appendChild(centralBtn);

    for (const plane of planes) {
      const row = document.createElement('div');
      row.className = 'move-row';

      for (const sign of [+1, -1]) {
        const btn = document.createElement('button');
        btn.className = 'move-btn';
        btn.textContent = `${plane} ${sign > 0 ? '+90°' : '−90°'}`;
        btn.addEventListener('click', () => app.executeMove(cellIndex, plane, sign));
        row.appendChild(btn);
      }
      body.appendChild(row);
    }

    group.appendChild(header);
    group.appendChild(body);
    scroll.appendChild(group);
  });
}

export function updateCentralBadge(panelEl, centralCellIndex) {
  const groups = panelEl.querySelectorAll('.cell-group');
  groups.forEach((g, i) => {
    const badge = g.querySelector('.cell-central-badge');
    if (badge) badge.style.display = i === centralCellIndex ? 'inline' : 'none';
    g.style.borderColor = i === centralCellIndex ? '#4af' : '';
  });
}

function rgbToHex([r, g, b]) {
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
