# Specification: Interactive WebGL Rubik’s Tesseract Application

## 1. Goal

Build an interactive WebGL application for exploring a **3×3×3×3 Rubik’s 4-cube**.

The application must support two modes:

1. **Regular mode**
   The user manually controls the Rubik’s tesseract:

   * rotate the visible 3D view,
   * choose which cell is displayed as the central cell,
   * execute any of the 48 legal basic cell turns.

2. **Demo mode**
   The application automatically executes all **48 basic quarter-turns**:

   * 8 cells,
   * 6 moves per cell,
   * executed sequentially in a consistent order.

The purpose is not only to show a tesseract, but to make the structure of the **4D Rubik puzzle** readable through an interactive 3D projection.

---

## 2. Terminology

Use real geometric and puzzle terminology.

### Core geometry

* **4-cube / tesseract / hypercube**
  The 4-dimensional analogue of a cube.

* **Cell**
  A 3-dimensional boundary component of the tesseract.
  A tesseract has **8 cells**.

* **3×3×3×3 Rubik’s 4-cube**
  A tesseract subdivided into 81 small 4D cubies.

* **Cubie**
  A small movable 4D piece of the puzzle, represented visually as a small 3D cube proxy.

* **Sticker**
  A colored visible face of a cubie. Stickers define the solved state.

* **Central cell**
  The cell currently shown as the inner / central 3×3×3 cube in the projection.

* **Outer cell**
  The cell opposite the central cell in the projection.

* **Adjacent cells**
  The six cells connected to the current central cell.

---

## 3. Puzzle Structure

The application should model the puzzle as a true **3×3×3×3 Rubik’s tesseract**, not as eight independent 3D cubes.

The model contains:

* 81 logical 4D cubies.
* 80 visible / stickered cubies.
* 1 fully internal unstickered cubie.
* 8 cells.
* 27 sticker positions per cell.
* 216 total stickers:

```text
8 cells × 27 stickers = 216 stickers
```

A cubie may belong to multiple cells:

* 1 sticker: cell-center type
* 2 stickers: hyper-center type
* 3 stickers: hyper-edge type
* 4 stickers: hyper-corner type

This sharing is essential. A cubie must not be treated as belonging permanently to only one cell.

---

## 4. Application Modes

## 4.1 Regular Mode

Regular mode is the default mode.

The user can:

* rotate the 3D view,
* select any of the 8 cells as the central cell,
* perform any legal cell turn,
* reset the puzzle,
* optionally undo / redo moves,
* optionally scramble the puzzle.

Regular mode should behave like an interactive puzzle, not only like a passive visualization.

---

## 4.2 Demo Mode

Demo mode automatically performs all 48 basic moves.

The sequence should be deterministic:

```text
Cell 1: move 1, move 2, move 3, move 4, move 5, move 6
Cell 2: move 1, move 2, move 3, move 4, move 5, move 6
...
Cell 8: move 1, move 2, move 3, move 4, move 5, move 6
```

Demo mode controls:

* Start demo
* Pause demo
* Resume demo
* Stop demo
* Step forward
* Step backward
* Speed control
* Loop on/off
* Reset before demo on/off

Default behavior:

* Demo starts from the solved state.
* Moves are executed sequentially.
* Each move is animated.
* After the final move, the app holds the final state or loops depending on the loop setting.

---

## 5. Controls

## 5.1 View Rotation Controls

The user must be able to rotate the visible 3D projection.

Supported controls:

* mouse drag,
* arrow keys,
* on-screen buttons.

These controls rotate the **view**, not the puzzle state.

Required view controls:

* rotate left
* rotate right
* rotate up
* rotate down
* reset view
* optional zoom in / zoom out

The view rotation must not modify the logical state of the puzzle.

---

## 5.2 Central Cell Selection

The user must be able to choose which of the 8 cells is shown as the central cell.

Supported controls:

* buttons inside each cell control group,
* keyboard keys `1–8`.

Changing the central cell should be animated.

Important distinction:

* Selecting a central cell is a **projection / view reorientation operation**.
* It should not scramble or modify the puzzle state.
* Visually, cubies should move smoothly into their new projected positions.
* The motion should feel consistent with the animation style used for puzzle turns.

---

## 5.3 Cell Turn Controls

Each of the 8 cells must have its own control group.

Each group contains:

* cell name / color indicator,
* “Use as central cell” button,
* 6 turn buttons.

Each cell has 6 basic moves:

```text
3 internal rotation planes × 2 directions = 6 moves
```

Example group layout:

```text
Cell +X
[Use as central cell]

YZ +90°   YZ -90°
YW +90°   YW -90°
ZW +90°   ZW -90°
```

For a cell fixed on one coordinate axis, its legal turn planes are the three planes formed by the remaining axes.

Example:

```text
Cell +X / -X:
YZ, YW, ZW

Cell +Y / -Y:
XZ, XW, ZW

Cell +Z / -Z:
XY, XW, YW

Cell +W / -W:
XY, XZ, YZ
```

---

## 6. Keyboard Shortcuts

Required shortcuts:

```text
1–8       select central cell
Arrow keys rotate view
Space     play / pause demo
R         reset puzzle
V         reset view
Esc       stop current animation / exit demo
```

Optional shortcuts:

```text
U         undo
Shift+U   redo
D         start demo
S         scramble
```

Cell turn shortcuts may be added later, but the primary cell turn interface should be button-based because 48 moves are too many for a clean keyboard-only scheme.

---

## 7. Animation Rules

All meaningful transitions should be animated.

Animated operations:

* legal cell turns,
* changing central cell,
* resetting the view,
* demo mode moves.

Animation constraints:

* Cubies keep constant size.
* Cubies do not stretch, scale, or deform during turns.
* Cubies move and rotate as rigid bodies.
* The visual transition should be smooth and eased.
* No operation should instantly teleport cubies unless animation is disabled.

During an active animation:

* new turn input should either be queued or temporarily disabled,
* the app should not allow conflicting simultaneous moves,
* demo mode should wait for each move animation to finish before starting the next move.

---

## 8. Move Semantics

A basic move is a 90° rotation of one cell in one of its three internal rotation planes.

Each move is defined by:

```text
cell
rotation plane
direction
```

Example:

```text
Cell +X, plane YZ, direction +90°
```

The affected cubies are all cubies currently belonging to that cell.

When a cell turns:

* affected cubies move as rigid bodies,
* their sticker orientation updates,
* cubies shared with adjacent cells move accordingly,
* the puzzle state changes permanently unless the move is undone or reset.

The app must not fake the move by rotating only the visible stickers of one isolated cell.

---

## 9. Central Cell Reorientation Semantics

Changing the central cell is not a puzzle move.

It changes how the 4D puzzle is projected into the 3D scene.

Requirements:

* The logical puzzle state stays unchanged.
* The selected cell becomes the central 3×3×3 cube.
* The opposite cell becomes the outer cell.
* The six remaining cells become surrounding / adjacent cells.
* Cubies animate smoothly from the old projection layout to the new projection layout.

This operation should make it possible to inspect the same puzzle state from different 4D-facing viewpoints.

---

## 10. Visual Model

Keep the visual model minimal.

Render only:

* cubies,
* their colored stickers,
* optional subtle shadow/reflection effects.

Do not render:

* tesseract wireframe,
* cell boundary boxes,
* coordinate axes,
* labels floating in the scene,
* debug grids,
* unnecessary UI overlays inside the 3D view.

The UI controls can exist outside the 3D canvas.

---

## 11. Cubie Layout

Cubies must have a constant rendered size.

Rules:

* Cubies do not change size depending on which cell they are in.
* Cubies do not scale when changing central cell.
* Cubies do not scale during cell turns.
* Projection may change their apparent positions, but not their intrinsic size.

The central cell should look like a compact ordinary **3×3×3 Rubik’s cube**:

* 27 cubies,
* minimal gaps,
* readable separation lines,
* no large empty voids between cubies.

Other cells may look more spread out due to projection, but the cubies themselves remain the same size.

---

## 12. Coloring

Use sticker-based coloring.

Use **8 solved-state colors**, one per cell.

Do not color each cubie as one solid color.

Instead:

* each sticker face receives the color of its source cell,
* cubies with multiple stickers show multiple colors,
* non-sticker faces use a dark neutral material.

This is the correct model because the solved state is defined by 8 colored cells, not by 24 independent 3D cube-face colors.

### Color count

Use:

```text
8 cell colors
```

Do not use:

```text
24 independent face colors
```

A 24-color system would describe projected cube faces, not the actual solved-state structure of the Rubik’s tesseract.

---

## 13. Transparency

Opacity depends on the cubie’s current projected role.

Recommended opacity:

```text
central cell cubies: 1.0
outer cell cubies:   0.45–0.60
adjacent cell cubies: 0.25
```

Rules:

* cubies in the central cell are fully opaque,
* cubies in the outer cell are semi-transparent,
* cubies in the six adjacent cells are highly transparent,
* opacity updates when the central cell changes,
* opacity updates during animated reorientation.

Cubies belonging to multiple cells should be rendered according to their dominant current projected placement, not by duplicating opacity per sticker.

---

## 14. UI Layout

The UI should be organized around the 8 cells.

Suggested layout:

```text
Top bar:
[Regular mode] [Demo mode] [Reset puzzle] [Reset view] [Speed]

Main area:
[WebGL canvas]

Side panel:
Cell +X
  [Use as central]
  [YZ +] [YZ -]
  [YW +] [YW -]
  [ZW +] [ZW -]

Cell -X
  [Use as central]
  ...

...
Cell -W
  [Use as central]
  ...
```

The “Use as central cell” control belongs inside each cell group because central-cell selection is conceptually tied to choosing a cell.

---

## 15. State Management

The application state should include:

```text
puzzleState
selectedCentralCell
viewRotation
currentMode
animationState
demoState
moveHistory
```

Minimum required state:

* current cubie positions,
* current cubie orientations,
* current sticker orientations,
* current central cell,
* current view rotation,
* whether animation is running,
* current demo move index.

Optional state:

* undo stack,
* redo stack,
* scramble seed,
* saved states,
* move notation history.

---

## 16. Reset Behavior

Required reset actions:

### Reset puzzle

Returns the puzzle to the solved state.

Does not necessarily reset:

* selected central cell,
* camera/view rotation.

### Reset view

Returns the camera/view rotation to default.

Does not modify:

* puzzle state,
* selected central cell.

### Reset all

Optional combined action:

* solved puzzle,
* default central cell,
* default view,
* demo stopped.

---

## 17. Demo Sequence Ordering

The 48 demo moves should use a stable canonical order.

Recommended order:

```text
Cells:
+X, -X, +Y, -Y, +Z, -Z, +W, -W

Within each cell:
plane 1 +90°
plane 1 -90°
plane 2 +90°
plane 2 -90°
plane 3 +90°
plane 3 -90°
```

Plane order depends on cell:

```text
±X: YZ, YW, ZW
±Y: XZ, XW, ZW
±Z: XY, XW, YW
±W: XY, XZ, YZ
```

---

## 18. Acceptance Criteria

The application is acceptable when:

* the user can manually execute all 48 moves,
* the demo mode executes all 48 moves automatically,
* the user can select any of the 8 cells as central,
* keys `1–8` select the central cell,
* view rotation works by mouse, arrow keys, and buttons,
* all cubies keep constant size,
* no cubie deforms during animation,
* the central cell reads as a compact 3×3×3 Rubik’s cube,
* cubies shared between cells visibly move between cells,
* sticker coloring makes the solved state understandable,
* UI controls are grouped by cell,
* the app stays visually minimal and focused.
