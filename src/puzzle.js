// Puzzle state: 81 cubies, cell definitions, move execution
import { applyPlaneRotation90, PLANE_AXES,
         mat4Identity, mat4Mul, mat4PlaneRotation } from './math4d.js';

// Snap a 4×4 (signed-permutation after 90° turns) to clean integers.
function snapMat4(m) {
  for (let i = 0; i < 16; i++) m[i] = Math.round(m[i]);
  return m;
}

// 8 cells: each defined by which axis is fixed and at which value (+1 or -1)
// Index 0..7 matches keyboard keys 1..8
export const CELLS = [
  { name: '+X', axis: 0, val: +1, color: [1.0, 0.2, 0.2] },   // 0 red
  { name: '-X', axis: 0, val: -1, color: [1.0, 0.6, 0.1] },   // 1 orange
  { name: '+Y', axis: 1, val: +1, color: [0.1, 0.8, 0.2] },   // 2 green
  { name: '-Y', axis: 1, val: -1, color: [0.1, 0.5, 1.0] },   // 3 blue
  { name: '+Z', axis: 2, val: +1, color: [1.0, 1.0, 0.1] },   // 4 yellow
  { name: '-Z', axis: 2, val: -1, color: [0.9, 0.9, 0.9] },   // 5 white
  { name: '+W', axis: 3, val: +1, color: [0.8, 0.1, 0.9] },   // 6 purple
  { name: '-W', axis: 3, val: -1, color: [0.1, 0.9, 0.9] },   // 7 cyan
];

// Rotation planes per cell axis
// Cell on ±X: free axes are Y,Z,W → planes YZ, YW, ZW
// Cell on ±Y: free axes are X,Z,W → planes XZ, XW, ZW
// Cell on ±Z: free axes are X,Y,W → planes XY, XW, YW
// Cell on ±W: free axes are X,Y,Z → planes XY, XZ, YZ
const CELL_PLANES = [
  ['YZ', 'YW', 'ZW'],  // ±X
  ['XZ', 'XW', 'ZW'],  // ±Y
  ['XY', 'XW', 'YW'],  // ±Z
  ['XY', 'XZ', 'YZ'],  // ±W
];

export function getCellPlanes(cellIndex) {
  const axis = CELLS[cellIndex].axis;
  return CELL_PLANES[axis];
}

// Build the solved puzzle: 81 cubies with 4D positions in {-1,0,+1}^4
// Each cubie stores: pos4 (Int8Array[4]), orientation (Mat4 as identity initially),
// and stickers: array of { faceDir: vec4, cellIndex, solvedColor }
export function buildSolvedPuzzle() {
  const cubies = [];

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        for (let w = -1; w <= 1; w++) {
          const pos = new Int8Array([x, y, z, w]);
          const stickers = computeStickers(pos);
          cubies.push({
            pos4: pos,             // current 4D grid position (cubie centre)
            solvedPos4: new Int8Array([x, y, z, w]),
            stickers,              // [{faceDir: Int8Array[4] = LOCAL sticker axis, cellIndex}]
            faceDirs: stickers.map(s => new Int8Array(s.faceDir)), // current world sticker dirs
            orient: mat4Identity(),// 4D orientation of the cubie's little tesseract
          });
        }
      }
    }
  }

  return cubies;
}

// A sticker exists on each face where |coord| == 1 in that axis direction
// The sticker's cell is determined by which axis == ±1
function computeStickers(pos) {
  const stickers = [];
  for (let axis = 0; axis < 4; axis++) {
    if (Math.abs(pos[axis]) === 1) {
      const val = pos[axis]; // +1 or -1
      // Find which cell owns this face
      const cellIndex = CELLS.findIndex(c => c.axis === axis && c.val === val);
      const faceDir = new Int8Array(4);
      faceDir[axis] = val;
      stickers.push({ faceDir, cellIndex });
    }
  }
  return stickers;
}

// Returns array of cubie indices belonging to cell (all cubies where pos[cell.axis] === cell.val)
export function getCellCubies(cubies, cellIndex) {
  const { axis, val } = CELLS[cellIndex];
  return cubies.reduce((acc, c, i) => {
    if (c.pos4[axis] === val) acc.push(i);
    return acc;
  }, []);
}

// Execute a move: rotate all cubies in cellIndex by 90° in planeName plane, sign +1/-1
// Modifies cubies in place. Returns move descriptor for undo.
export function executeMove(cubies, cellIndex, planeName, sign) {
  const [a, b] = PLANE_AXES[planeName];
  const affected = getCellCubies(cubies, cellIndex);

  // The 4×4 rotation this move applies to every affected cubie's frame.
  const R = mat4PlaneRotation(a, b, sign * Math.PI / 2);

  const snapshots = affected.map(i => ({
    i,
    oldPos: new Int8Array(cubies[i].pos4),
    oldFaceDirs: cubies[i].faceDirs.map(fd => new Int8Array(fd)),
    oldOrient: new Float64Array(cubies[i].orient),
  }));

  for (const idx of affected) {
    const c = cubies[idx];
    // Rotate position
    const newPos = applyPlaneRotation90(c.pos4, a, b, sign);
    c.pos4[0] = Math.round(newPos[0]);
    c.pos4[1] = Math.round(newPos[1]);
    c.pos4[2] = Math.round(newPos[2]);
    c.pos4[3] = Math.round(newPos[3]);

    // Rotate all face directions
    for (let si = 0; si < c.faceDirs.length; si++) {
      const fd = c.faceDirs[si];
      const newFd = applyPlaneRotation90(fd, a, b, sign);
      fd[0] = Math.round(newFd[0]);
      fd[1] = Math.round(newFd[1]);
      fd[2] = Math.round(newFd[2]);
      fd[3] = Math.round(newFd[3]);
    }

    // Rotate the cubie's 4D orientation: Q ← R · Q  (snap to clean integers)
    c.orient = snapMat4(mat4Mul(R, c.orient));
  }

  return { cellIndex, planeName, sign, snapshots };
}

// MIDDLE-SLICE: rotate the whole `fAxis = 0` hyper-slab of the tesseract — the central
// cube's middle layer (9) PLUS the adjacent cells' middle slices lying in the same plane.
// This is the slab between the two side cells ±f, so top-slab(+f) + middle + bottom-slab(−f),
// all the same direction, exactly equal a whole-puzzle reorientation (solved stays solved).
// The slab-axis cells ±f stay untouched (their cubies have pos4[fAxis]=±1). Like an M/E/S
// slice it isn't a product of cell turns, but it IS one of the puzzle's moves (inverse too),
// so every reachable state stays solvable. (`centralCellIndex` kept for the descriptor.)
export function middleNetSign(cubie, centralCellIndex, fAxis) {
  return cubie.pos4[fAxis] === 0 ? 1 : 0;
}

// Apply a middle-slice move (see middleNetSign). Returns a snapshot descriptor that
// undoMove can restore, just like executeMove.
export function executeMiddleMove(cubies, centralCellIndex, fAxis, planeName, sign) {
  const [a, b] = PLANE_AXES[planeName];
  const affected = [];
  cubies.forEach((c, i) => { const ns = middleNetSign(c, centralCellIndex, fAxis); if (ns !== 0) affected.push({ i, ns }); });

  const snapshots = affected.map(({ i, ns }) => ({
    i, ns,
    oldPos: new Int8Array(cubies[i].pos4),
    oldFaceDirs: cubies[i].faceDirs.map(fd => new Int8Array(fd)),
    oldOrient: new Float64Array(cubies[i].orient),
  }));

  for (const { i, ns } of affected) {
    const c = cubies[i];
    const s = ns * sign;                                  // this cubie's net ±90°
    const newPos = applyPlaneRotation90(c.pos4, a, b, s);
    c.pos4[0] = Math.round(newPos[0]); c.pos4[1] = Math.round(newPos[1]);
    c.pos4[2] = Math.round(newPos[2]); c.pos4[3] = Math.round(newPos[3]);
    for (let si = 0; si < c.faceDirs.length; si++) {
      const fd = c.faceDirs[si];
      const nfd = applyPlaneRotation90(fd, a, b, s);
      fd[0] = Math.round(nfd[0]); fd[1] = Math.round(nfd[1]);
      fd[2] = Math.round(nfd[2]); fd[3] = Math.round(nfd[3]);
    }
    c.orient = snapMat4(mat4Mul(mat4PlaneRotation(a, b, s * Math.PI / 2), c.orient));
  }

  return { type: 'middle', centralCellIndex, fAxis, planeName, sign, snapshots };
}

// Undo a move by restoring snapshots
export function undoMove(cubies, moveDescriptor) {
  for (const { i, oldPos, oldFaceDirs, oldOrient } of moveDescriptor.snapshots) {
    cubies[i].pos4.set(oldPos);
    for (let si = 0; si < cubies[i].faceDirs.length; si++) {
      cubies[i].faceDirs[si].set(oldFaceDirs[si]);
    }
    cubies[i].orient = new Float64Array(oldOrient);
  }
}

// Deep clone puzzle (for undo stack snapshots if needed)
export function clonePuzzle(cubies) {
  return cubies.map(c => ({
    pos4: new Int8Array(c.pos4),
    solvedPos4: new Int8Array(c.solvedPos4),
    stickers: c.stickers.map(s => ({ faceDir: new Int8Array(s.faceDir), cellIndex: s.cellIndex })),
    faceDirs: c.faceDirs.map(fd => new Int8Array(fd)),
    orient: new Float64Array(c.orient),
  }));
}
