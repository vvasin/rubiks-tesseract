// Twist-button icons, derived from 4 hand-crafted base glyphs (see assets/*.svg):
// FULL cube / TOP slab / MIDDLE slab / BOTTOM slab — all drawn as a counter-clockwise
// rotation about the VERTICAL (y) axis. Every other icon is a transform of these:
//   • opposite direction → mirror (scaleX −1)
//   • other rotation axis → rotate the whole glyph 120°/240° (the iso cube is 3-fold
//     symmetric about its main diagonal, so this maps the vertical axis to the others).
// We map the vertical axis to screen-Y, so the top/bottom-face and yaw buttons use the
// unrotated glyphs as-drawn; screen-X → 120°, screen-Z → 240°.
//
// main.js maps each button to the centred cell's concrete 4D plane/sign; the icons stay
// static because the canonical frame always sends the free axes to the same screen x/y/z.

const STRUCT = 'currentColor';                 // cube edges / slab fill / cut lines
const ARROW  = '#5ad7ff';                      // rotation arrow (accent), so it reads on dark

// ── base-glyph geometry (viewBox −130..130, cube centred at origin) ─────────────
const FACES = [
  '0,-100 86.6,-50 0,0 -86.6,-50',             // top
  '-86.6,-50 0,0 0,100 -86.6,50',              // left
  '0,0 86.6,-50 86.6,50 0,100',                // right
];
// Slab side-faces (left, right quad) per kind, and which whole faces it tints.
const SLAB = {
  top:    { L: '-86.6,-50 0,0 0,33.33 -86.6,-16.67',   R: '0,0 86.6,-50 86.6,-16.67 0,33.33',  cap: 0, arrowY: -25 },
  middle: { L: '-86.6,-16.67 0,33.33 0,66.67 -86.6,16.67', R: '0,33.33 86.6,-16.67 86.6,16.67 0,66.67', cap: -1, arrowY: 8.33 },
  bottom: { L: '-86.6,16.67 0,66.67 0,100 -86.6,50',   R: '0,66.67 86.6,16.67 86.6,50 0,100',   cap: -1, arrowY: 41.67 },
};
const CUTS = [   // the two division lines on each of the left & right faces
  '-86.6,-16.67 0,33.33', '-86.6,16.67 0,66.67', '0,33.33 86.6,-16.67', '0,66.67 86.6,16.67',
];

const edge = pts => `<polygon points="${pts}" fill="none" stroke="${STRUCT}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>`;
const tint = pts => `<polygon points="${pts}" fill="${STRUCT}" fill-opacity="0.16" stroke="none"/>`;
const cut  = pts => { const [a, b] = pts.split(' '); const [x1, y1] = a.split(','), [x2, y2] = b.split(','); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${STRUCT}" stroke-width="3.6" stroke-linecap="round"/>`; };
const arrow = (y, id) => `<path d="M-72.17,${y} C-28.87,${y + 41.67} 28.87,${y + 41.67} 72.17,${y}" fill="none" stroke="${ARROW}" stroke-width="7.2" stroke-linecap="round" marker-end="url(#${id})"/>`;

// Inner body for a base kind ('full' | 'top' | 'middle' | 'bottom').
function body(kind, id) {
  const edges = FACES.map(edge).join('');
  if (kind === 'full') return edges + arrow(8.33, id);
  const s = SLAB[kind];
  const cap = s.cap === 0 ? tint(FACES[0]) : '';      // top kind also tints the top face
  const slab = tint(s.L) + tint(s.R);
  const lines = CUTS.map(cut).join('');
  return edges + cap + slab + lines + arrow(s.arrowY, id);
}

// Wrap a base body in the axis-rotation + direction-mirror transform.
function glyph(kind, axisRot, mirror) {
  const id = `ar-${kind}-${axisRot}-${mirror ? 'm' : 'p'}`;
  return `<svg viewBox="-110 -110 220 220" fill="none" aria-hidden="true" style="color:#e6e6ee">
    <defs><marker id="${id}" markerWidth="48" markerHeight="48" refX="24" refY="24" orient="auto"
      markerUnits="userSpaceOnUse"><path d="M0,0 L48,24 L0,48 L8,24 Z" fill="${ARROW}"/></marker></defs>
    <g transform="rotate(${axisRot}) scale(${mirror ? -1 : 1},1)">${body(kind, id)}</g></svg>`;
}

// ── button tables + public icon builders ────────────────────────────────────────
const AXIS_ROT = { 1: 0, 0: 120, 2: 240 };     // screen axis (e-index) → glyph rotation°
const KEY_AXIS = { yaw: 1, pitch: 0, roll: 2 }; // cube-rotation key → screen axis

// SET 1 — whole-cube rotation (about screen y/x/z, ±). Layout: +row then −row.
export const TURN_BUTTONS = [
  { key: 'yaw',   iIdx: 0, jIdx: 2, dir: +1 },
  { key: 'pitch', iIdx: 1, jIdx: 2, dir: +1 },
  { key: 'roll',  iIdx: 0, jIdx: 1, dir: +1 },
  { key: 'yaw',   iIdx: 0, jIdx: 2, dir: -1 },
  { key: 'pitch', iIdx: 1, jIdx: 2, dir: -1 },
  { key: 'roll',  iIdx: 0, jIdx: 1, dir: -1 },
];
export function turnIcon(key, dir) {
  return glyph('full', AXIS_ROT[KEY_AXIS[key]], dir < 0);
}

// SET 2 — layer turns (per screen axis k): outer slabs (s = +1 top / −1 bottom) and the
// middle slab. controls.js builds the per-axis groups from these.
export function faceIcon(k, s, dir) {
  return glyph(s > 0 ? 'top' : 'bottom', AXIS_ROT[k], dir < 0);
}
export function middleIcon(k, dir) {
  return glyph('middle', AXIS_ROT[k], dir < 0);
}
