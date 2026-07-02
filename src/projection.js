// 4D → 3D projection driven by an explicit CORE FRAME.
//
// The core tesseract's orientation is a 4D frame: three "free" unit axes
// (e0,e1,e2 → screen x,y,z) and a depth axis eF (the central-cell direction).
// A cell turn is an absolute 4D rotation of the affected cubies (it never
// touches the frame). Centering is a 4D rotation of the FRAME (the cubies hold
// still in 4D; only the viewpoint sweeps), giving the inside-out motion for free.
//
// Cubies are drawn as constant-size cubes at depth-nested centres; each face is
// coloured by whichever sticker currently points along that free axis.

import { CELLS } from './puzzle.js';
import { mat4MulVec4, mat4FromCols, mat4Transpose, mat4Mul, mat4Det, so4Slerp } from './math4d.js';

// Cubies are drawn as their OWN little Schlegel tesseract (same projection style as
// the core): inner cell → small central cube, outer cell → big enclosing cube,
// 6 side cells → frustums. CUBE_S is tuned so a side cell's outer face lands ~0.58
// (matching the old flat-cube look). PERSP_SLOPE sets the inner/outer size ratio.
export const CUBE_S = 0.41;            // intrinsic half-size of every cubie
const PERSP_SLOPE = 0.42;              // local depth perspective: +depth smaller, −depth bigger
const CUBIE_SHRINK = 0.9;              // inset toward each cell's centroid (kills shared-face z-fight)
const DARK = [0.10, 0.10, 0.13];       // internal (non-sticker) faces

// Per-corner depth perspective for a cubie's local tesseract. Clamped so a
// depth-involving turn can never blow a cell up or invert it.
function cubiePersp(dz) {
  const s = 1 - PERSP_SLOPE * dz;
  return s < 0.3 ? 0.3 : (s > 1.7 ? 1.7 : s);
}

function smoothstep(lo, hi, x) {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

// How much sticker colour a cell shows (solid mode), as a function of its current
// depth facing `df` and its committed (end-of-turn) depth facing `dft`. Comparing the
// two tells us which way the cell is heading, so we can time colour to the collisions
// instead of blacking the whole cubie:
//
//   • side cell, not transitioning (|dft| ≈ |df|): always painted (the S1–S4 group).
//   • HIDING (|dft| > |df|, becoming inner/outer): stay painted, fade out late — it's
//     still side-like through the early part of its slide into depth.
//   • REVEALING (|dft| < |df|, becoming a side cell): stay BLACK until it has emerged,
//     then paint. The outer-side reveal (df<0, the old outer cell breaking through the
//     stationary sides too) paints latest of all.
//
// Net effect: hiders and revealers are never both lit during a crossover, yet the
// stationary sides stay coloured — so the puzzle is never all-black, snaps and all.
const SIDE_FADE_HI = 0.5;              // |df| at/above which a settled cell is black
function sideColorWeight(df) {
  return 1 - smoothstep(0, SIDE_FADE_HI, Math.abs(df));
}
function colorWeight(df, dft) {
  const a = Math.abs(df), at = Math.abs(dft);
  if (at > a + 1e-4) return 1 - smoothstep(0.55, 0.92, a);          // hiding: paint, fade out late
  if (at < a - 1e-4) {                                             // revealing: black, paint late
    const lo = df < 0 ? 0.12 : 0.30, hi = df < 0 ? 0.42 : 0.60;    // outer-side reveal paints latest
    return 1 - smoothstep(lo, hi, a);
  }
  return sideColorWeight(df);                                       // settled / stationary side
}

// How "solid" a cubie is vs wireframe (normal mode): the central cell renders solid,
// the outer layers as wireframe. Driven by depth along the central axis,
// d = pos4·eF (1 = central cell, 0/−1 = outer), which slides continuously as the
// frame sweeps (centering) or the cubie moves across the layer (turns). The solid is
// dithered away by this weight, revealing the wireframe underneath during the handoff.
const SOLID_LO = 0.4, SOLID_HI = 0.9;
function solidWeight(p, frame) {
  return smoothstep(SOLID_LO, SOLID_HI, dot4(p, frame.eF));
}

const CORE_EXT = 1;                    // lattice half-extent: core cell corners sit on the
                                       // ±1 corner-cubie centres (projected identically)

// Centre radius vs depth (cubies keep constant size, so deeper shells just
// spread out → gaps you can see the inner layers through).
function depthR(w) { return 2.8 - 1.45 * w; }   // w=1→1.35, 0→2.8, −1→4.25

// CLASSIC view: how far a side cell is pulled outward along its facing direction so the
// per-cubie side stickers spread into the core-tesseract frustums (Magic-Cube-4D look).
// One depth level: pulling an inner-layer side cell by this lands it at the level the
// middle-layer side cells occupy in normal mode (and middle → outer), since depthR is
// linear so consecutive layers are an equal distance apart.
export const PULL_DIST = depthR(0) - depthR(1);   // = 1.45 (also the grouped cluster's
                                                  // uniform sticker-grid spacing — App's
                                                  // classic swipe surfaces build on it)

// ── 4D vector helpers ─────────────────────────────────────────────────────────

function dot4(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]; }
function unit4(axis, val) { const v = [0,0,0,0]; v[axis] = val; return v; }
function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function norm3(v) { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }

// ── Core frame ────────────────────────────────────────────────────────────────

// Canonical, axis-aligned frame that makes `cellIndex` central. It is forced to be
// right-handed (det +1) so that every cell→cell centering is a PROPER 4D rotation
// with a clean geodesic, and so revisiting a cell always lands on the same
// orientation (the stable-centering guarantee). Swap the last two free axes when the
// naive frame is left-handed.
export function frameForCell(cellIndex) {
  const ax = CELLS[cellIndex].axis, val = CELLS[cellIndex].val;
  const free = [0,1,2,3].filter(a => a !== ax);
  let e = [unit4(free[0], 1), unit4(free[1], 1), unit4(free[2], 1)];
  if (mat4Det(mat4FromCols(e[0], e[1], e[2], unit4(ax, val))) < 0) {
    e = [e[0], e[2], e[1]];
  }
  return { e, eF: unit4(ax, val) };
}

// Frame ↔ column-major 4×4 (columns = e0,e1,e2,eF).
function frameToMat(f) { return mat4FromCols(f.e[0], f.e[1], f.e[2], f.eF); }
function matToFrame(M) {
  return {
    e: [[M[0],M[1],M[2],M[3]], [M[4],M[5],M[6],M[7]], [M[8],M[9],M[10],M[11]]],
    eF: [M[12],M[13],M[14],M[15]],
  };
}

// Geodesic interpolation of the core frame from `fromFrame` to `toFrame` by t∈[0,1].
// Both are signed-permutation frames; the SO(4) geodesic is smooth at every angle
// (including the 180° opposite-cell case) and lands EXACTLY on toFrame at t=1.
export function slerpFrame(fromFrame, toFrame, t) {
  const Mf = frameToMat(fromFrame), Mt = frameToMat(toFrame);
  const Rt = so4Slerp(mat4Mul(Mt, mat4Transpose(Mf)), t);   // world rotation from→to, eased by t
  return matToFrame(mat4Mul(Rt, Mf));
}

export function cloneFrame(f) {
  return { e: f.e.map(v => v.slice()), eF: f.eF.slice() };
}

// Which cell is central for a (rest) frame: the axis eF points along.
export function centralFromFrame(f) {
  let ax = 0, best = 0;
  for (let k = 0; k < 4; k++) if (Math.abs(f.eF[k]) > Math.abs(best)) { best = f.eF[k]; ax = k; }
  const val = best > 0 ? 1 : -1;
  return CELLS.findIndex(c => c.axis === ax && c.val === val);
}

// ── Projection ────────────────────────────────────────────────────────────────

// Project a 4D point through the frame → { pos3:[x,y,z], depth }.
function project(p, frame) {
  const d = dot4(p, frame.eF);
  const R = depthR(d);
  return [dot4(p, frame.e[0]) * R, dot4(p, frame.e[1]) * R, dot4(p, frame.e[2]) * R];
}

function isHidden(pos4) {
  let nz = 0;
  for (let i = 0; i < 4; i++) if (pos4[i] !== 0) nz++;
  return nz < 2;
}

// Free-axis 3D components of a 4D vector (its position in the projected cube).
function freeComps(v, frame) {
  return [dot4(v, frame.e[0]), dot4(v, frame.e[1]), dot4(v, frame.e[2])];
}

// The 6 faces of a box, corner index b = p0|p1<<1|p2<<2 over the 3 perp axes.
const BOX_FACES = [[1,3,7,5],[0,2,6,4],[2,3,7,6],[0,1,5,4],[4,5,7,6],[0,1,3,2]];

const BOX_EDGES = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
const WIRE_UNUSED = [0.30, 0.33, 0.40];   // colour of an "unused" (non-sticker) cell in wireframe
const WIRE_SHRINK = 0.95;                 // cell wireframes a touch smaller → don't collapse together

// Internal: the 8 projected cell BOXES of one cubie, drawn as the cubie's own
// little Schlegel tesseract (inner small cube, outer big cube, 6 side frustums),
// each inset toward its centroid. color is the sticker colour or null (unused).
// Shared by the solid and wireframe renderers so they always agree.
//
// The outer cell self-hides: it shares each outer face with a side cell, but its
// centroid is the cubie centre (far from those faces), so the SAME inset pulls its
// faces well inward while the side cells' big faces barely move — the side faces
// win the depth test and the inner/outer cells stay tucked behind them.
function cubieBoxes(cubie, center, orient, frame, targetOrient = orient, classic = null) {
  const cubieC = project(center, frame);
  const colorOf = {};
  for (const sk of cubie.stickers) {
    for (let k = 0; k < 4; k++) if (sk.faceDir[k] !== 0) colorOf[k*2 + (sk.faceDir[k] > 0 ? 0 : 1)] = CELLS[sk.cellIndex].color;
  }
  const pulling = classic && classic.mode === 'main' && classic.t > 0;

  const boxes = [];
  for (let a = 0; a < 4; a++) for (const s of [1, -1]) {
    const ln = [0,0,0,0]; ln[a] = s;
    const lnw = mat4MulVec4(orient, ln);                        // this cell's outward dir (world)
    const df  = dot4(lnw, frame.eF);                           // current depth facing
    const dft = dot4(mat4MulVec4(targetOrient, ln), frame.eF);  // committed (end-of-turn) depth facing
    const perp = [0,1,2,3].filter(x => x !== a);
    const C8 = new Array(8);
    let cx = 0, cy = 0, cz = 0;
    for (let b = 0; b < 8; b++) {
      const lc = [0,0,0,0]; lc[a] = s;
      lc[perp[0]] = (b & 1) ? 1 : -1;
      lc[perp[1]] = (b & 2) ? 1 : -1;
      lc[perp[2]] = (b & 4) ? 1 : -1;
      const lcw = mat4MulVec4(orient, lc);
      const k = CUBE_S * cubiePersp(dot4(lcw, frame.eF));   // local depth perspective
      const fc = freeComps(lcw, frame);
      C8[b] = [cubieC[0] + k*fc[0], cubieC[1] + k*fc[1], cubieC[2] + k*fc[2]];
      cx += C8[b][0]; cy += C8[b][1]; cz += C8[b][2];
    }
    let ctr = [cx/8, cy/8, cz/8];
    for (let b = 0; b < 8; b++)                            // inset toward cell centre
      C8[b] = [ctr[0]+(C8[b][0]-ctr[0])*CUBIE_SHRINK, ctr[1]+(C8[b][1]-ctr[1])*CUBIE_SHRINK, ctr[2]+(C8[b][2]-ctr[2])*CUBIE_SHRINK];
    // CLASSIC main view: rearrange side cells (df≈0) into tight core-tesseract frustums,
    // size/shape preserved. Inner/outer cells (|df|≈1) are left in place (sideW≈0).
    //   1) PULL OUT — translate outward along the cell's facing direction by PULL_DIST, so
    //      each cell's layers detach from the centre (inner→middle level, middle→outer, …).
    //   2) GROUP — compact the two in-face (tangential) axes onto a uniform PULL_DIST grid
    //      so the cell reads as one tight cluster: the centre column stays put, the rest
    //      shift toward the cell's centre axis (corners diagonally, edges h/v) — the same
    //      step distance as the pull-out, both vertical and horizontal.
    if (pulling) {
      const sideW = 1 - smoothstep(0.2, 0.85, Math.abs(df));
      if (sideW > 0.001) {
        const w = classic.t * sideW;
        const fc = freeComps(lnw, frame);                 // outward (facing) direction, projected
        const mag = Math.hypot(fc[0], fc[1], fc[2]) || 1;
        const dRad = PULL_DIST * w / mag;
        const sh = [fc[0]*dRad, fc[1]*dRad, fc[2]*dRad];   // (1) radial pull-out along the facing dir
        // (2) tangential grouping (opt-in, weighted by classic.group ∈ [0,1] so it eases in/out).
        // Weight each screen axis by how PERPENDICULAR it is to the facing direction (`1 − f̂ₖ²`:
        // 0 on the facing axis, 1 across it) instead of an argmax pick — so as the frame rotates
        // during a recentering the split stays continuous and the stickers glide between clusters
        // rather than snapping when the dominant axis flips.
        const groupW = (classic.group == null ? 1 : classic.group) * w;
        if (groupW > 0.001) for (let k = 0; k < 3; k++) {
          const fk = fc[k] / mag;
          const tangW = 1 - fk * fk;
          const g = Math.max(-1, Math.min(1, dot4(center, frame.e[k])));   // in-face lattice coord
          sh[k] += tangW * (g * PULL_DIST - cubieC[k]) * groupW;  // toward the uniform PULL_DIST grid
        }
        for (let b = 0; b < 8; b++) { C8[b][0] += sh[0]; C8[b][1] += sh[1]; C8[b][2] += sh[2]; }
        ctr = [ctr[0]+sh[0], ctr[1]+sh[1], ctr[2]+sh[2]];
      }
    }
    boxes.push({ color: colorOf[a*2 + (s > 0 ? 0 : 1)] || null, C8, ctr, df, dft });
  }
  return { cubieC, boxes };
}

// CLASSIC view, per box: opacity multiplier. Classic shows only the cells that carry
// the grouped-sticker look — the focused (inner) cell plus, in the main view, the pulled
// side cells — and dithers the rest away:
//   • uncolored ("unused") cells vanish entirely;
//   • main view: the outer (−eF facing) cell vanishes (the big enclosing cube is dropped);
//   • sub-views: every non-inner cell vanishes (only the cell's own 3×3 face remains).
function classicHide(box, classic) {
  if (!classic || classic.t <= 0) return 1;
  if (!box.color) return 1 - classic.t;                          // unused cells: gone in classic
  let hide;
  if (classic.mode === 'sub') hide = 1 - smoothstep(0.2, 0.85, box.df);   // keep only the inner cell
  else hide = classic.keepOuter ? 0 : smoothstep(0.2, 0.85, -box.df);     // drop the outer cell (unless kept)
  return 1 - classic.t * hide;
}

// Sticker colour weight for a box. Normal mode times colour to the depth crossover
// (colorWeight, the blackening). Classic mode disables that blackening — every shown
// sticker reads at full colour — lerping there over the transition. Exception: when the
// outer cell is being dropped (keepOuter off), it keeps its normal (black) weight so it
// fades out BLACK rather than flashing its colour mid-transition.
function classicColorWeight(box, classic) {
  const w = box.color ? colorWeight(box.df, box.dft) : 0;
  if (!classic || classic.t <= 0 || !box.color) return w;
  let paint = classic.t;
  if (classic.mode === 'main' && !classic.keepOuter) paint *= 1 - smoothstep(0.2, 0.85, -box.df);
  return w + (1 - w) * paint;
}

// Emit the (camera-facing) quad faces of a cubie's 8 cell boxes into `faces`, at the
// given opacity. Colour each box by its sticker via colorWeight (DARK when unused/
// hidden). Normals point outward from each cell's own centroid so cells self-cull.
function pushBoxFaces(faces, boxes, opacity, classic = null) {
  for (const bx of boxes) {
    const C8 = bx.C8, ctr = bx.ctr;
    const op = opacity * classicHide(bx, classic);
    if (op <= 0.004) continue;
    const w = classicColorWeight(bx, classic);
    const color = w <= 0 ? DARK
      : w >= 1 ? bx.color
      : [DARK[0]+(bx.color[0]-DARK[0])*w, DARK[1]+(bx.color[1]-DARK[1])*w, DARK[2]+(bx.color[2]-DARK[2])*w];
    for (let fi = 0; fi < BOX_FACES.length; fi++) {
      const F = BOX_FACES[fi];
      const q = [C8[F[0]], C8[F[1]], C8[F[2]], C8[F[3]]];
      const fcx=(q[0][0]+q[1][0]+q[2][0]+q[3][0])*0.25 - ctr[0];
      const fcy=(q[0][1]+q[1][1]+q[2][1]+q[3][1])*0.25 - ctr[1];
      const fcz=(q[0][2]+q[1][2]+q[2][2]+q[3][2])*0.25 - ctr[2];
      let n = norm3(cross3(sub3(q[1],q[0]), sub3(q[2],q[0])));
      if (n[0]*fcx + n[1]*fcy + n[2]*fcz < 0) n = [-n[0],-n[1],-n[2]];
      faces.push({ color, quad: q, normal: n, opacity: op, sortDepth: 0 });
    }
  }
}

// Solid render: each cubie's cell boxes → outward (camera-facing) quad faces.
//
// Per-cubie opacity is set by the focused-layer weight `sw` (1 = central, 0 = side) and
// the side policy:
//   • sideAlpha = 0 (default): only the focused layer is solid (opacity = sw); side
//     cubies fall below the cutoff and drop out — the classic solid-centre look.
//   • sideAlpha > 0, centralSolid: side cells become translucent solids floored at
//     sideAlpha (opacity = max(sw, sideAlpha)) — the semitransparent mode. The screen-
//     door dither makes them see-through with no sorting (order-independent).
//   • sideAlpha > 0, !centralSolid: the centre is drawn as wireframe elsewhere, so the
//     solid is the side role only — it fades OUT as a cubie reaches the focused layer
//     (opacity = sideAlpha·(1−sw)) while the wireframe fades in.
export function computeCells(cubies, frame, getState = null, { sideAlpha = 0, centralSolid = true, classic = null } = {}) {
  const faces = [];
  cubies.forEach((cubie, i) => {
    if (isHidden(cubie.pos4)) return;
    const st = getState ? getState(i) : null;
    const center4 = st ? st.center4 : cubie.pos4;
    const sw = solidWeight(center4, frame);   // 0 = pure side, 1 = focused layer
    const opacity = sideAlpha <= 0 ? sw
      : centralSolid ? Math.max(sw, sideAlpha)
      : sideAlpha * (1 - sw);
    if (opacity <= 0.02) return;
    // Pass the committed orientation as the target so each cell knows whether it's
    // heading toward the side role (revealing) or toward inner/outer (hiding).
    const { boxes } = cubieBoxes(
      cubie, center4, st ? st.orient : cubie.orient, frame, cubie.orient, classic);
    pushBoxFaces(faces, boxes, opacity, classic);
  });
  return faces;
}

// Sub-views are not a separate projection: a cell shown with `frame = frameForCell(i)`
// puts the cell's own axis on depth, so only its cubies have a high focused-layer weight
// (`solidWeight ≈ 1`) — its side stickers become the 6 cube faces and the along-axis
// mini-cells read dark. So a sub-view is just `computeCells` (solid) or `computeWireframe`
// (wire) on the sub-frame; cubies sliding out during a neighbour's turn fade via the same
// `sw`-keyed dither as the main view, instead of popping.

// ── Wireframes (debug / perception) ───────────────────────────────────────────

// Push the 12 edges of an 8-corner box, shrunk toward its centre, as segments at the
// given opacity (the renderer screen-door dithers lines just like solid faces, so a
// wireframe cubie can fade to nothing as it leaves the focused layer).
function pushBoxEdges(out, C8, color, shrink, opacity = 1) {
  let cx=0,cy=0,cz=0;
  for (const p of C8) { cx+=p[0]; cy+=p[1]; cz+=p[2]; }
  cx/=8; cy/=8; cz/=8;
  const V = C8.map(p => [cx+(p[0]-cx)*shrink, cy+(p[1]-cy)*shrink, cz+(p[2]-cz)*shrink]);
  for (const [i,j] of BOX_EDGES) out.push({ a: V[i], b: V[j], color, opacity });
}

// Wireframe render: every cubie cell as its own (slightly shrunk) cube wireframe,
// coloured by its sticker cell or as "unused". Options select the role this wireframe
// plays against the focused-layer weight `sw = solidWeight` (1 = central, 0 = side):
//   • skipSolid — drop cubies the solid centre fully covers (sw ≥ 0.98), so the side-cell
//     wireframe only shows where there is no solid on top of it (central solid + side wire).
//   • fade — opacity = sw, so a wireframe cubie dithers OUT as it slides to the side role
//     (a central-wireframe whose side appearance is "none", and every sub-view).
// Without either flag every cubie is drawn opaque — a flat all-wireframe inspection.
export function computeWireframe(cubies, frame, getState = null, { skipSolid = false, fade = false, classic = null } = {}) {
  const segs = [];
  cubies.forEach((cubie, i) => {
    if (isHidden(cubie.pos4)) return;
    const st = getState ? getState(i) : null;
    const center4 = st ? st.center4 : cubie.pos4;
    const sw = solidWeight(center4, frame);
    if (skipSolid && sw >= 0.98) return;        // the solid cube covers this cubie
    const opacity = fade ? sw : 1;
    if (opacity <= 0.02) return;
    const orient = st ? st.orient : cubie.orient;
    const { boxes } = cubieBoxes(cubie, center4, orient, frame, orient, classic);
    // Classic hides/pulls per cell just like the solid path (edges dither out with it).
    for (const bx of boxes) pushBoxEdges(segs, bx.C8, bx.color || WIRE_UNUSED, WIRE_SHRINK, opacity * classicHide(bx, classic));
  });
  return segs;
}

// The 8 core-tesseract cells, each a (slightly shrunk) cube wireframe in its cell
// colour. During a turn the active cell's cube is rotated by the live move R, so
// the big cell visibly rotates in sync with its cubies.
// Render the core cell boxes that are currently in motion only — there is no
// static full-core wireframe. `cellList` are the cell indices to draw; `spinCell`
// (if given) gets the live turn rotation R applied. Recentering rotation comes
// for free through the interpolated `frame` the caller passes in.
export function computeCoreWireframe(frame, cellList, spinCell = -1, R = null) {
  const segs = [];
  for (const ci of cellList) {
    const ax = CELLS[ci].axis, val = CELLS[ci].val;
    const free = [0,1,2,3].filter(a => a !== ax);
    const spin = (ci === spinCell) ? R : null;
    const C8 = [];
    for (let b = 0; b < 8; b++) {
      const v = [0,0,0,0];
      v[ax] = val * CORE_EXT;
      v[free[0]] = ((b&1)?1:-1) * CORE_EXT;
      v[free[1]] = ((b&2)?1:-1) * CORE_EXT;
      v[free[2]] = ((b&4)?1:-1) * CORE_EXT;
      C8.push(project(spin ? mat4MulVec4(spin, v) : v, frame));
    }
    const c = CELLS[ci].color;
    const col = [Math.min(1, c[0]*0.5+0.5), Math.min(1, c[1]*0.5+0.5), Math.min(1, c[2]*0.5+0.5)];
    // Separation inset. Most cells shrink toward their centroid. The OUTER cell is
    // inside-out (its centre projects to the origin, its corners to the far hull),
    // so shrinking it inward reads as "too small / inside the boundary" — it must
    // grow outward instead. Key the inset on depth facing (+1 central, 0 side,
    // −1 outer) so it flips smoothly through a recentering rather than popping.
    const depthSign = dot4(unit4(ax, val), frame.eF);
    const inset = 1 - WIRE_SHRINK;
    const shrink = depthSign >= 0 ? WIRE_SHRINK : WIRE_SHRINK - 2 * inset * depthSign;
    pushBoxEdges(segs, C8, col, shrink);
  }
  return segs;
}
