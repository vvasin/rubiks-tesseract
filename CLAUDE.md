# Rubik's Tesseract — agent brief

Interactive WebGL visualization of a **3×3×3×3 Rubik's tesseract**. Pure client-side
vanilla JS (ES modules, WebGL 1.0), no build step, no dependencies. The point is to make
the 4D puzzle *readable* through an interactive 3D projection — not to be a solver.

This file is the orientation for a future session. It records the **current** design and
the non-obvious decisions behind it; it is not the original spec (we diverged from that
deliberately — see "How the model evolved"). Read the rationale before changing the
projection or coloring — most of it is the result of long iteration and looks arbitrary
out of context.

## Run & test

```bash
npm install && npx playwright install chromium   # one-time setup on a fresh clone
npm start            # dev server (scripts/serve.js) at http://localhost:8791
npm test             # Playwright e2e (auto-starts the server); specs in tests/
npm run lint         # ESLint
```

No build step — `index.html` loads `src/*.js` as ES modules directly. There are no unit
tests; correctness is verified by driving the real app (Playwright). The app exposes
`window.__app` for introspection/control:

```js
const a = window.__app;
a.viewYaw = -0.6; a.viewPitch = 0.5; a.viewZoom = 1.4; a.viewRot = a._composeViewRot();
a.anim.speedFactor = 0.1;           // slow animations down to capture mid-transition
a.executeMove(2, 'XW', +1);         // cellIndex, planeName, sign
a.selectCentralCell(4);             // animated recentering
a.coreFrame;                        // current 4D frame {e:[e0,e1,e2], eF}
```
To capture a specific moment in a turn, poll `a.anim.active` and compute progress from
`(performance.now() - active.startTime) / (active.duration / a.anim.speedFactor)`. The
canvas uses `preserveDrawingBuffer`, so it can be read back via a 2D canvas in tests.

## Files

- `index.html` / `style.css` — top bar, canvas, view overlay, per-cell side panel, status bar.
- `src/main.js` — `App`: state, render loop (`_loop`), view (yaw/pitch/zoom), centering, UI wiring. Bootstraps `window.__app`.
- `src/math4d.js` — 4×4 / 3×3 matrix + 4D vector helpers (`mat4PlaneRotation`, `mat4MulVec4`, `PLANE_AXES`, `mat3AxisRotation`, …).
- `src/puzzle.js` — cubie model, `CELLS` (the 8 cells + colors), `executeMove`/`undoMove`, `buildDemoSequence`.
- `src/projection.js` — **the heart**: 4D→3D projection, cubie geometry, color fade, wireframes. Almost all design decisions live here.
- `src/renderer.js` — WebGL: opaque, depth-tested, **no back-face culling**. Draws solid quads + `gl.LINES` for wireframe.
- `src/animation.js` — `AnimationEngine`: move/centering queue, easing, per-frame state. `MOVE_DURATION=360ms`, `TRANSITION_DURATION=620ms`, `speedFactor`.
- `src/controls.js` — mouse/touch/keyboard input; builds the per-cell control panel.
- `src/demo.js` — `DemoMode`: sequenced playback of the 48 moves.
- `src/shaders.js` — GLSL. Two-sided lambert (`abs(dot(n,light))`), `u_ambient=0.42`; screen-door (hashed) dither `discard` — keeps each fragment with probability `a_opacity`, for the solid→wireframe dissolve.
- `scripts/serve.js` — zero-dep static dev server (sets ESM MIME types). `tests/` — Playwright specs. `playwright.config.js`, `eslint.config.js`, `package.json` — infra.

## Puzzle model (`puzzle.js`)

- 81 logical cubies, `pos4 ∈ {-1,0,1}⁴`. Each carries `pos4`, `solvedPos4`, `stickers`
  (`{faceDir, cellIndex}`, `faceDir` is a LOCAL axis), `faceDirs` (current world dirs),
  and `orient` (a 4×4 matrix = the cubie's own 4D orientation).
- 8 **cells** = the tesseract's 3D facets, one per ±axis. `CELLS[i]` (i matches keys 1–8):
  `+X`red `-X`orange `+Y`green `-Y`blue `+Z`yellow `-Z`white `+W`purple `-W`cyan.
- A cubie belongs to every cell where `|pos4[axis]|==1` (1–4 stickers: cell-center →
  hyper-corner). Cells genuinely **share** cubies; a move on one cell moves shared cubies.
- **A cell turn is an absolute 4D rotation of the affected cubies** (`executeMove` rotates
  `pos4`, `faceDirs`, and `orient` by `mat4PlaneRotation`). It never touches the frame.
  Legal planes per cell axis: ±X→YZ,YW,ZW · ±Y→XZ,XW,ZW · ±Z→XY,XW,YW · ±W→XY,XZ,YZ.

## Projection model (`projection.js`) — read this before touching rendering

> **Central tension:** a 4D rotation's 3D shadow can't be both a rigid constant-size
> cube *and* smoothly reveal/hide the colors it swaps. We keep the cube rigid and pay
> for the reveal in color, not shape. The long-form rationale, the collision analysis
> behind the color fade, and the approaches we tried and dropped live in
> [docs/model-notes.md](docs/model-notes.md) — read it before reworking the projection
> or coloring.

Two distinct 4D→3D projections coexist on purpose:

**1. The core frame** `{ e:[e0,e1,e2], eF }` — three orthonormal "free" axes mapped to
screen x/y/z, plus a depth axis `eF` (the central-cell direction). `project(p) =
[p·e0, p·e1, p·e2] · depthR(p·eF)`, with `depthR(w)=2.8−1.45w` (w=1→1.35 inner, 0→2.8,
−1→4.25 outer). This is a Schlegel-style 4D perspective: the central cell is the small
inner cube, the opposite cell the big enclosing one, the 6 others spread between.
- **Centering is a 4D rotation of the FRAME**, not the cubies (`rotateFrame`,
  `centeringPlan`). Cubies hold still in 4D; the viewpoint sweeps inside-out. `main._loop`
  interpolates `coreFrame` during the animation; `_onCentralComplete` commits it.
- Cubies with <2 nonzero coords are hidden (`isHidden`): the 8 cell-centers + 1 core
  cubie. So **72 cubies render**, not 80.

**2. Each cubie is its OWN little Schlegel tesseract** (`cubieBoxes`), *placed* at its
core position but *shaped* independently (so it doesn't inherit core distortion — it reads
as a clean cube, not a "shard of the core"). 8 cells per cubie: inner small cube, outer
big cube, 6 side frustums, via `cubiePersp(dz)=1−PERSP_SLOPE·dz`. `CUBE_S=0.41` so a side
cell's outer face lands ~0.58 (the cube-face size). Each cell is inset toward its centroid
by `CUBIE_SHRINK=0.9` — and because the **outer cell is inside-out** (centroid at the
cubie center, far from its faces) the same inset pulls it well behind the side stickers, so
it self-hides without z-fighting.

### Coloring & the snap-hiding fade (the subtle part)

Only side cells should show sticker color; the inner/outer cells must read dark. But a
depth-involving turn rotates cells through the depth axis, and solid faces swapping depth
order make colors "snap." The fix is to **time color to the cell's depth facing** so every
swap hands off black-to-black, *without* ever blacking the whole puzzle:

- `df = (orient·cellAxis)·eF` — current depth facing (±1 inner/outer, 0 side).
- `dft` — the same at the **committed** (end-of-turn) orientation. Comparing `|dft|` to
  `|df|` tells which way the cell is heading.
- `colorWeight(df, dft)`: **settled/stationary side** (|dft|≈|df|) → painted; **hiding**
  (|dft|>|df|) → stay painted, fade out late; **revealing** (|dft|<|df|) → stay black,
  paint late (outer-side reveal, `df<0`, paints latest). Color lerps DARK↔sticker by this.
- Net: stationary sides stay lit, only the transitioning faces go dark through their
  crossover. The trade (accepted): the moving cell vs *stationary side* collisions still
  snap, but the puzzle is never all-black. Centering uses the symmetric settled fade.

### Solid centre, wireframe shell (the default view)

In normal (non-toggle) mode the **central cell renders solid; the 7 outer-layer cells
render as wireframe** — the focused 3×3×3 reads as a clean Rubik's cube while the rest of
the tesseract is see-through structure, not a wall of cubes. Per cubie,
`solidWeight = smoothstep(0.4, 0.9, pos4·eF)` (1 = central layer, →0 outward); it slides
continuously as the frame sweeps (centering) or a cubie crosses the layer (a turn whose
plane includes the central axis). `computeCells` skips `sw≤0.02` cubies and tags faces
with `opacity=sw`; `computeWireframe(…, skipSolid=true)` skips the solid (`sw≥0.98`) ones.
The handoff is a **screen-door dither dissolve**: the shader keeps each fragment with
probability `sw`, so a transitioning cubie's solid sprouts holes that reveal the wireframe
behind it — no alpha blending, depth buffer untouched. Steady state needs no blending
(every cubie is cleanly solid or wireframe).

### Other rendering facts

- **No back-face culling** (`renderer.js`). The depth buffer handles occlusion; culling
  used to delete a face as it went edge-on, leaving see-through holes between the cubie's
  separate cell boxes. Removing it makes cubies stay solid at grazing angles.
- `DARK=[0.10,0.10,0.13]` for non-sticker faces; background `[0.04,0.04,0.06]`.
- **Wireframe toggle** (`W`) — full-wireframe inspection, distinct from the default view's
  outer shell above: replaces *everything* with wireframe. `computeWireframe` draws each
  cubie cell as a shrunk
  cube outline; `computeCoreWireframe` draws the 8 core cells as cube outlines, *always
  visible*, the active cell spinning during a turn, all rotating during centering. The core
  cell corners sit exactly on the corner-cubie centers (`CORE_EXT=1`); side cells inset
  inward, the inside-out outer cell insets **outward** so it encloses its cubies.

## View, modes, controls

- **View** is a turntable: independent `viewYaw`/`viewPitch` (recomposed by
  `_composeViewRot`, pitch clamped to ±90°) so horizontal drag never introduces roll.
  `viewZoom` sets camera distance (`15/zoom`). View changes never touch puzzle state.
- **Modes**: Regular (default) and Demo (auto-plays the 48 moves: 8 cells × 6 ×
  +90°/−90°, canonical order). Speed slider affects both.
- **Keys**: `1–8` central cell · arrows rotate view · `Space` demo play/pause · `R` reset
  puzzle · `V` reset view · `W` wireframe · `Esc` stop demo · `D` demo · `S` scramble ·
  `U`/`Shift+U` undo/redo. Mouse drag orbits; wheel / two-finger pinch / ±buttons zoom.

## Invariants to preserve

- Cubies are constant size and never deform; the central cell reads as a compact 3×3×3.
- Coloring is **sticker-based, 8 cell colors** (not 24 face colors); non-sticker faces dark.
- Visuals stay minimal: only cubies (+ optional wireframe). No axes/labels/grids in canvas.
- Cell turn = cubie 4D rotation; centering = frame 4D rotation. Keep these separate.

## How the model evolved (why it doesn't match a naive reading of the spec)

The original spec lives in git history. Key departures, all intentional:
the cubies-as-pieces-of-one-core idea was dropped (looked crooked) for independent
per-cubie tesseracts; transparency-as-translucent-fills was abandoned for opaque
depth-nesting with visible gaps (a different see-through — wireframe outer layers with a
dither dissolve — later returned for the default view; that's structural edges, not
translucent fills); the constant-size cube look is achieved by each cubie's own Schlegel
projection + the color fade above. If something here seems redundant or odd, it almost certainly fixes
a specific visual artifact (color snaps, edge bleed, grazing-angle holes, all-black turns)
— check git history / don't "simplify" it away without reproducing the artifact first.

For the reasoning in full — the collision model the color fade is built on, and the
approaches we tried and rejected (whole-cubie blackout, per-face fade) — see
[docs/model-notes.md](docs/model-notes.md).
