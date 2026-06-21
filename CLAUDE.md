# Rubik's Tesseract — agent brief

A small, **mobile-first playable game** of a **3×3×3×3 Rubik's tesseract**. Pure
client-side vanilla JS (ES modules, WebGL 1.0), no build step, no dependencies. It makes
the 4D puzzle *readable* through an interactive 3D projection — there is no solver.

The screen is **9 synchronized views**: the big main tesseract projection plus 8 small
cell sub-views (4 top + 4 bottom), each showing one cell as a plain 3×3×3 Rubik's cube.
You twist the **centred** cell by **swiping across it** in the main view (the primary input)
or with on-canvas icon buttons (layer turns + whole-cube rotation, in groups around the
cube), and tap a sub-view to bring a different cell to centre. All 9 views share one
turntable orientation.

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
a.executeMove(2, 'XW', +1);         // cellIndex, planeName, sign (any cell/plane)
a.turnScreenPlane(0, 2, +1);        // twist the CENTRED cell via a screen-plane button (iIdx,jIdx,dir)
a.centralStickers();                // the ≤27 swipe hit-areas (client-px quads) of the centred cube
a.applyCentralSwipe(start, x, y);   // turn the layer a swipe from sticker `start` exits toward (x,y)
a.selectCentralCell(4);             // animated, stable recentering
a.shuffle();                        // one-shot scramble (SHUFFLE_TURNS moves, full speed)
a.setCentralMode('wire');           // focused layer: 'solid' | 'wire'
a.setSideMode('none');              // side cells: 'semi' | 'solid' | 'wire' | 'none'
a.setCoreWire(true);               // core-tesseract wireframe overlay on/off
a.setClassic(true);                // classic ('exploded cells', MC4D-style) view on/off
a.classicT;                        // animated 0→1 classic transition weight
a.coreFrame;                        // current 4D frame {e:[e0,e1,e2], eF} — at rest, a canonical frame
```
To capture a specific moment in a turn, poll `a.anim.active` and compute progress from
`(performance.now() - active.startTime) / (active.duration / a.anim.speedFactor)`. The
canvas uses `preserveDrawingBuffer`, so it can be read back via a 2D canvas in tests.

## Files

- `index.html` / `style.css` — game shell: one full-area canvas, the 4-top/4-bottom cell tiles, the stage (menu button + the 4 twist-button groups), and the menu/confirm overlays. Mobile-first, `dvh` + safe-area insets; `#app` width = `min(100vw,100dvh)` (square-capped) so the main view grows on wide screens, with the cell strips capped/centered.
- `src/main.js` — `App`: state, **9-view render loop** (`_loop`/`_render`, dirty-flag redraw), view (yaw/pitch/zoom), stable centering, screen-plane→move dispatch (`turnScreenPlane`/`turnFace`/`turnMiddle`, against a view-following `_buttonFrame` for buttons), direct **swipe-to-turn** (`centralStickers`/`applyCentralSwipe`), shuffle, menu/view-mode wiring, **session persistence** (`_serialize`/`_restoreSettingsUI` + a debounced `_scheduleSave`). Bootstraps `window.__app`.
- `src/math4d.js` — 4×4 / 3×3 matrix + 4D vector helpers (`mat4PlaneRotation`, `mat4MulVec4`, `PLANE_AXES`, …) **+ the SO(4) geodesic** (`so4Slerp`, `so4Decompose`, `mat4Det`, `mat4FromCols`) used by stable centering.
- `src/puzzle.js` — cubie model, `CELLS` (the 8 cells + colors), `executeMove`/`undoMove`, the middle-slice (`executeMiddleMove`/`middleNetSign`), and persistence (de)serialization of the mutable cubie fields (`serializeCubies`/`restoreCubies`).
- `src/projection.js` — **the heart**: 4D→3D projection, cubie geometry, color fade, wireframes (solid `computeCells` / wireframe `computeWireframe`, both keyed off the focused-layer weight `solidWeight` so they double as sub-views on a cell's own frame), canonical frames + `slerpFrame`, and the core-tesseract wireframe (`computeCoreWireframe`). Almost all design decisions live here.
- `src/renderer.js` — WebGL: opaque, depth-tested, **no back-face culling**. `beginFrame()` clears the whole canvas; `drawView(cells, viewRot, segments, camDist, rect, zoom)` renders one scissored viewport (`zoom` crops/magnifies without moving the camera) — called once per view.
- `src/animation.js` — `AnimationEngine`: move / middle-slice / centering queue, easing, per-frame state (per-cubie net sign for slices). `MOVE_DURATION=360ms`, `TRANSITION_DURATION=620ms`, `speedFactor`.
- `src/controls.js` — unified pointer input: a drag that starts on a centred-cube sticker is a **layer swipe** (resolved via `App.centralStickers`/`applyCentralSwipe`) and never orbits; a drag that starts on the background or a cell tile orbits all views; tap a tile to centre that cell; pinch zoom. Plus keyboard; builds the cell tiles (`buildCellTiles`) and the 4 twist-button groups around the cube (`buildTurnControls`), shown/hidden by `setControlSet`.
- `src/icons.js` — twist-button SVG icons, reconstructed in code from 4 hand-crafted base glyphs (full-cube / top / middle / bottom slab — a CCW rotation about the vertical axis) and derived by transform: opposite direction = mirror, other axis = rotate 120°/240° (the iso cube is 3-fold symmetric). Vertical axis = screen-Y. `turnIcon`/`TURN_BUTTONS` (cube rotation, `full`), `faceIcon` (outer `top`/`bottom` slab), `middleIcon` (middle slab). Arrow uses the accent colour; the cube uses `currentColor`.
- `src/shaders.js` — GLSL. Two-sided lambert (`abs(dot(n,light))`), `u_ambient=0.42`; screen-door dither `discard` via an **ordered Bayer 8×8** threshold (uniform frosted stipple, not noise) — keeps each fragment with probability `a_opacity`, for the solid→wireframe dissolve and the translucent semitransparent side cells.
- `src/persistence.js` — `localStorage` read/write (best-effort: any storage/parse failure is swallowed) + a `debounce(fn, ms)` helper with `.flush()`. See "Persistence" below.
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
- **Centering is a 4D rotation of the FRAME**, not the cubies. Cubies hold still in 4D;
  the viewpoint sweeps inside-out. `_render` interpolates `coreFrame` via `slerpFrame`;
  `_onCentralComplete` commits it.
- **Stable centering (the key invariant):** every cell has a fixed **canonical frame**
  `frameForCell(i)`, forced right-handed (det +1) so any cell→cell move is a *proper* SO(4)
  rotation. Centering interpolates along the **SO(4) geodesic** (`slerpFrame` → `so4Slerp`,
  a double-quaternion / van Elfrinkhof factorization — smooth at every angle, including the
  180° opposite-cell hop) and **commits the destination's canonical frame exactly**. So
  revisiting a cell always lands on the identical orientation (A→B→A is bit-exact) — fixing
  the old drift where a face other than the cell's came forward. (The old `rotateFrame`/
  `centeringPlan` single-plane path is retired; don't reintroduce it.)
- Cubies with <2 nonzero coords are hidden (`isHidden`): the 8 cell-centers + 1 core
  cubie. So **72 cubies render**, not 80.

**Sub-views.** Each of the 8 cell tiles renders the **same** `computeCells` / `computeWireframe`
as the main view, just on that cell's own canonical frame (`frameForCell(i)`): with the cell's
axis as depth only its cubies have a high focused-layer weight, so its 6 side stickers form the
cube faces and the along-axis cells read dark — the centred-cell look, isolated. A sub-view is
effectively "central, side = none": it follows the **Central cell** mode (solid or wireframe),
and a cubie sliding out during a neighbour's turn **fades to nothing via the same dither** as
the main view instead of popping. Sub-views share the **one `viewRot`** (synchronized turntable)
but never animate centering; they do animate turns (shared `getState`), so a twist of the centred
cell rigidly spins its own cube while scrambling the neighbours'. All 9 views are drawn into
scissored viewports of one canvas.

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

### Presentation: focused layer vs side cells (three independent settings)

How the tesseract reads is **three independent menu settings**, all hung off one quantity —
the focused-layer weight `solidWeight = smoothstep(0.4, 0.9, pos4·eF)` (1 = central layer,
→0 outward), which slides continuously as the frame sweeps (centering) or a cubie crosses the
layer (a turn whose plane includes the central axis):

- **Central cell** = `solid` (default) or `wire` — how the `sw≈1` cubies draw.
- **Side cells** = `semi` (default) / `solid` / `wire` / `none` — how the `sw≈0` cubies draw. `semi`
  draws them as **translucent solids** (the whole tesseract reads as nested frosted cubes); `solid`
  draws them **fully opaque** (`SIDE_FLOOR.solid=1.0` — the floor path with α=1; needed for the
  authentic classic view); `wire` as edges; `none` hides them.
- **Core tesseract** wireframe = on/off — the separate `computeCoreWireframe` overlay (default off).

A fourth, **independent** toggle — **Classic view** (the *Display* group + the corner button) — is
documented in its own section below; it rearranges geometry rather than picking a draw style.

The default (solid centre, semitransparent sides, no core) shows the focused 3×3×3 as a clean
opaque Rubik's cube with the rest of the tesseract as see-through frosted cubes around it (`wire`
sides is the older shell look). `computeCells` takes `{sideAlpha, centralSolid}`: with `sideAlpha=0`
(default) only the focused layer is solid (`opacity=sw`, skips `sw≤0.02`); with `sideAlpha>0` and a
solid centre the sides are floored translucent (`opacity=max(sw, sideAlpha)`, `SIDE_ALPHA=0.4`); with
`sideAlpha>0` and a wire centre the solid is the side role only (`opacity=sideAlpha·(1−sw)`), fading
out as a cubie reaches the focused layer. `computeWireframe` options — `skipSolid` drops the cubies
the solid centre fully covers (`sw≥0.98`), `fade` sets `opacity=sw` so a *wireframe* cubie can
dissolve out too.

Every **central→side hand-off is carried by the screen-door dither** (the shader keeps each
fragment — face *or* line — with probability `opacity`, no alpha blending, depth buffer
untouched):

| central → side | how it transitions |
|---|---|
| solid → semi | solid faces dither down to a translucent floor (`sw`→`SIDE_ALPHA`) — never vanish *(default)* |
| solid → wire | solid faces dither out over a full-opacity side wireframe *(the classic shell)* |
| solid → none | solid faces dither out **into nothing** |
| wire → semi | side solids dither out as the central wireframe fades in |
| wire → wire | edges stay at full opacity throughout — **no** transition |
| wire → none | edges dither out **into nothing** (`fade`) |

Each main-view combo picks the right `computeWireframe` call (see `_render`). **Sub-views reuse
this exactly** on the cell's own frame as "central, side = none", so a cubie leaving the cell
fades instead of popping. Steady state needs no blending (every cubie is cleanly solid, wireframe,
or absent).

### Classic ("exploded cells") view — `classicT`, an independent geometry toggle

A separate toggle (Settings → *Display* → **Classic view**, and the corner button; `App.setClassic`,
persisted) shows the tesseract as a **set of grouped stickers**, à la Magic Cube 4D. It's animated by
`classicT ∈ [0,1]` (App-owned tween, `CLASSIC_DURATION=620ms`÷speed, eased — *not* an `AnimationEngine`
job; `_tickClassic` runs in `_loop` and keeps the loop "busy"). Every compute call takes a `classic`
arg — `{ t, mode }` with `mode` `'main'` (the big view) or `'sub'` (cell tiles) — handled in
`cubieBoxes`/`pushBoxFaces`/`computeWireframe`:

- **Sub-views** (`mode:'sub'`): keep **only each cubie's inner cell** (`df≈+1`), dither the side/outer
  cells away — so a tile becomes that cell's own flat 3×3 sticker grid (`classicHide` = `1−innerWeight(df)`).
- **Main view** (`mode:'main'`): drop every **unused** cell and every **outer** cell (`df≈−1`, i.e. the
  big enclosing/opposite cube; `classicHide` = `smoothstep(0.2,0.85,−df)`); keep the inner cell (central
  small cube) and rearrange the side cells (`df≈0`, weighted `sideW`, animated by `classicT`),
  size/shape preserved, into tight **core-tesseract side-cell frustums** — two steps in `cubieBoxes`:
  - **pull out** — translate along the cell's facing free-direction by `PULL_DIST = depthR(0)−depthR(1)
    = 1.45` (one depth level; `depthR` is linear so layers are equal-spaced). Inner-layer side cells
    land at the middle layer's level, middle at the outer's.
  - **group** (opt-in — *Group side cells*, `groupSides`, default on; its own `groupT` tween so toggling
    it slides) — compact the two in-face (tangential) axes onto a uniform `PULL_DIST` grid (`g·PULL_DIST`
    target, the centre column `g=0` stays put), so each cell reads as one cluster instead of a spread —
    corners move diagonally, edges horizontally/vertically, the same step distance as the pull-out. Each
    screen axis is weighted by how perpendicular it is to the facing dir (`1 − f̂ₖ²`), **not** an argmax
    pick — otherwise the radial/tangential split flips when the dominant axis crosses over mid-recentre
    (e.g. +X→+Y) and the stickers visibly snap between clusters.

These are **render-time offsets on the cell boxes only** — the cubies (their 4D state and projected
centres) never move; the clusters rotate with the core frame during centering because the offsets are
recomputed in the live frame each tick.
- The **depth blackening is disabled** (`classicColorWeight` lerps `colorWeight`→1): every shown sticker
  reads full colour. The transition uses the **same screen-door dither** (unused/outer cells dissolve;
  side cells morph out). Classic composes with the side mode (opacity/style) — the **authentic** look is
  Side cells = `solid`; with `semi` the frustums are translucent. The central swipe model is unchanged
  (the central cube stays at `depthR(1)`).
- **Outer cell** (*Classic view* group → *Outer cell*; `keepOuter`, default off, main view only). Off:
  the outer core cell (big enclosing cube) is dropped — and `classicColorWeight` keeps it at its normal
  **black** weight while it dithers out, so it doesn't flash its colour mid-transition. On: it isn't
  hidden (`classicHide`→1) and is painted to full colour, so the enclosing cube stays visible. Both
  *Outer cell* and *Group side cells* live in a *Classic view* settings group, disabled while classic
  mode is off (`_updateClassicControls`).

### Other rendering facts

- **No back-face culling** (`renderer.js`). The depth buffer handles occlusion; culling
  used to delete a face as it went edge-on, leaving see-through holes between the cubie's
  separate cell boxes. Removing it makes cubies stay solid at grazing angles.
- `DARK=[0.10,0.10,0.13]` for non-sticker faces; background `[0.04,0.04,0.06]`.
- **Core-tesseract wireframe** (the *Core tesseract* checkbox; `W` toggles the Central cell
  mode solid↔wire) — `computeCoreWireframe` draws the 8 core cells as cube outlines, the active
  cell spinning during a turn, all rotating during centering. The core cell corners sit exactly
  on the corner-cubie centers (`CORE_EXT=1`); side cells inset inward, the inside-out outer cell
  insets **outward** so it encloses its cubies. It's an independent overlay now, so a full
  wireframe inspection = Central `wire` + Side `wire` + Core on. (Only the **main view** shows
  the core overlay; sub-views never do.)

## View, modes, controls

- **View** is a turntable shared by all 9 views: independent `viewYaw`/`viewPitch`
  (recomposed by `_composeViewRot`, pitch clamped to ±90°) so horizontal drag never
  introduces roll. `viewZoom` sets the camera distance (`MAIN_CAM/zoom`) shared by all 9
  views; sub-views additionally crop-zoom in (`SUBVIEW_ZOOM`) to fill their tile (same
  perspective as the main view). View changes never touch puzzle state.
- **Turning**: all moves act on the **centred** cube; to work on another cell, tap its
  sub-view to centre it first. Buttons sit in **4 groups framing the cube** (Settings →
  Controls picks which show: `central` (default) / `sides` / `both` / `none` (zen — hide all,
  twist by swiping)):
  - **bottom** — whole-cube rotation (`turnScreenPlane`): rotate the centred cell, 3 screen
    axes × 2 = 6.
  - **top / left / right** — per-axis **layer turns** (screen Y / X / Z), each = 3 slabs ×
    2 dirs:
    - outer slabs (`turnFace(kScreen, sSide, dir)`) — turn the **side cell** on that face in
      the depth-avoiding plane = a normal Rubik's face turn (same family the shuffle uses).
    - middle slab (`turnMiddle(kScreen, dir)`) — see "Middle slice" below.
  Every button is a STATIC icon, but its **target follows the view**: the icons depict a cube
  cornered edge-toward-you showing a front-left, front-right, and top face, and the buttons
  resolve against `_buttonFrame()` — the canonical frame with its two **horizontal** axes
  (`e0`,`e2`) rotated by the view's nearest yaw quarter-turn (relative to `DEFAULT_YAW`), so the
  front-left / front-right slots always point at the faces actually in those positions. The
  **top axis `e1` is deliberately left static** (so is `eF`). It's a proper 90°-quantised
  rotation (det stays +1), so at the resting view it *is* the canonical frame (no change) and
  every sign convention below still holds. (Only the buttons use `_buttonFrame`; swipes read
  true on-screen geometry, so they're already view-correct and pass the canonical frame.)
  `_screenPlaneMove` then maps the chosen screen-plane to the centred cell's concrete
  `(planeName, sign)`; its permutation-parity factor makes `dir=+1` always a right-handed CCW
  turn about the +screen axis (matching the icon arrow) — without it the Y plane (0,2), being
  cyclically odd, comes out inverted.
- **Swipe to turn** (`App.centralStickers` / `applyCentralSwipe`, driven by `controls.js`): the
  same layer turns are also reachable by **dragging across the centred cube** directly. Because
  a central-cell cubie always projects to a clean grid (`pos4·eF = 1` → `depthR(1)=1.35`
  constant), the 3×3×3 is modelled as an idealized cube and its ≤27 visible stickers are
  projected to client pixels through the renderer's *exact* camera (frame, yaw/pitch, zoom).
  Back-facing and below-threshold (`MIN_STICKER_FRAC`, edge-on) stickers are dropped, leaving the
  clearly-targetable ones. **The turn is fixed by which EDGE of the start sticker the swipe exits
  through** — `applyCentralSwipe` expresses the displacement from the sticker centre in that
  sticker's in-face tangent basis (read perspective-correctly off its projected quad); the
  dominant tangent is the drag axis, the *other* tangent is the rotation axis, the start's coord
  along it is the slab (0 → `turnMiddle`, ±1 → `turnFace`), and the sign makes the grabbed sticker
  travel the way the finger went — reusing the exact same move/sign machinery as the buttons.
  Keying off the exit edge (not a second sticker) is deliberate: it cleanly handles a swipe that
  **wraps over a cube edge onto another face of the same cubie** (the literal corner case) and one
  that **runs off into empty space**. **Press-time decides the gesture:** a drag begun on a sticker
  only ever turns — it never orbits, and if it never leaves the start sticker it's simply ignored;
  a drag begun on the background/tiles orbits as before.
- **Middle slice** (`turnMiddle` → `executeMiddleMove`): rotate the whole **`fAxis=0`
  hyper-slab** — every cubie with `pos4[fAxis]=0` (27: the centred cube's middle layer + the
  adjacent cells' middle slices in that plane), in the slice plane. It's the slab *between*
  the two side cells ±f, so **top-slab(+f) + middle + bottom-slab(−f), same direction, equal
  a whole-puzzle reorientation** (solved stays solved) — the key consistency the design
  requires; the slab-axis cells ±f stay untouched. On the centred cube the faces stay still
  and the middle ring turns. Like an M/E/S slice it isn't a product of cell turns, but it
  **is** one of the puzzle's moves (its inverse is too) and the shuffle only uses cell turns,
  so every reachable state stays solvable. (`middleNetSign` returns 1 for the slab; the
  per-cubie-sign animation path is shared with normal moves.)
- **Shuffle** (menu) is a **one-shot**: `SHUFFLE_TURNS` (20) clean side-cell turns on the
  current centre — only the plane that avoids the depth axis, so never depth-involving —
  recentering between rounds, run at full speed regardless of the speed slider.
- **Menu**: a scrollable body (`.menu-body`, header pinned) — **Shuffle + Reset (danger)** side by
  side (`.menu-actions`, equal width) · Settings (animation speed slider, 9 odd steps so default
  *medium* sits dead-centre; the multi-value groups lay options in two equal flex columns that
  collapse to one on a narrow panel — `.opts`): Controls = Cube rotation (default) / Layer turns /
  Both / None; Central cell = Solid (default) / Wireframe; Side cells = Semitransparent (default) /
  Solid / Wireframe / None; *Display* = **Classic view** + Core tesseract checkboxes (default off); a
  ***Classic view*** group (styled like the others) = **Outer cell** (keep the outer core cell, default
  off) + **Group side cells** (default on) checkboxes, both **disabled while classic is off**
  (`_updateClassicControls`).
  Classic is **also** a corner icon button (top-left, opposite the menu button — an unfolded-cube-net
  glyph; `.active` lights it accent).
- **Keys** (desktop convenience): `1–8` centre cell · arrows rotate view · `R` reset puzzle
  · `V` reset view · `W` toggle Central cell solid↔wireframe · `U`/`Shift+U` undo/redo. Pointer drag on the
  centred cube swipes a layer (above); drag on the background/tiles orbits; tap a sub-view
  tile to centre it; wheel / two-finger pinch zoom.

## Persistence (`persistence.js` + `App`)

The session survives a refresh / reopened tab via `localStorage` (key
`rubiks-tesseract/state/v1`). What's saved: the **puzzle** (only the mutable cubie fields —
`pos4`, `faceDirs`, `orient`; the solved scaffold is rebuilt by `buildSolvedPuzzle` in the
same deterministic order, so `restoreCubies` just overwrites those three per cubie), the
**central cell index**, and the **settings** (speed-slider value, control set, the
presentation settings — central mode, side mode, core-wireframe flag, and the classic-view flags:
`classic`, `keepOuter`, `groupSides`). A legacy saved `viewMode` (`total-wire`) migrates on load.
The classic flag restores settled (`classicT = classic ? 1 : 0`, never mid-tween).

- **Central cell is stored as an index, not a frame.** On load `coreFrame = frameForCell(central)`
  — the canonical frame — so restore lands on the exact stable orientation the centering
  invariant guarantees (never a mid-animation frame).
- **View orientation (yaw/pitch/zoom) is intentionally NOT persisted** — transient turntable
  state, reset on reload by design.
- **Speed is read from the slider**, not `anim.speedFactor`, so a temporary shuffle-speed
  override is never saved.
- **Writes are debounced** (`SAVE_DEBOUNCE=500ms`): `_scheduleSave` is called at every state
  mutation (move complete, centering commit, recenter, undo, reset, settings change) and
  coalesces bursts / a shuffle into one write; flushed on `pagehide` and `visibilitychange→
  hidden` so the last move isn't lost on mobile.
- **Best-effort & defensive:** all storage/parse access is wrapped in try/catch (private mode,
  quota, corruption are swallowed); `restoreCubies` validates shape and applies all-or-nothing,
  and every restored setting/index is range-checked, falling back to the solved/default value.

## Invariants to preserve

- Cubies are constant size and never deform; the central cell reads as a compact 3×3×3.
- Coloring is **sticker-based, 8 cell colors** (not 24 face colors); non-sticker faces dark.
- Visuals stay minimal: only cubies (+ optional wireframe). No axes/labels/grids in canvas.
- Cell turn = cubie 4D rotation; centering = frame 4D rotation. Keep these separate.
- All 9 views share **one** `viewRot`. Centering must commit a **canonical** frame
  (`frameForCell`), so revisiting a cell is always identical (stable centering).

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

Most recently the workbench demo became a **mobile-first game**: the desktop top-bar +
per-cell side panel and the Demo auto-player were dropped; the start/stop scramble loop
became a one-shot Shuffle; the single projection became 9 synchronized views (main + 8
cell cubes); and centering was rebuilt on canonical frames + an SO(4) geodesic so it is
*stable* on revisits. The 4D model, projection, and color fade below were kept intact.

For the reasoning in full — the collision model the color fade is built on, and the
approaches we tried and rejected (whole-cubie blackout, per-face fade) — see
[docs/model-notes.md](docs/model-notes.md).
