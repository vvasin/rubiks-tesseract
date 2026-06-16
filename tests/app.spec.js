// End-to-end smoke/robustness tests. There are no unit tests — correctness here is
// "the real app runs, renders, and survives every interaction without console errors."
// Reference screenshots land in test-results/screenshots/ for manual inspection (we
// avoid pixel-baseline snapshots: WebGL output differs across machines/GPUs).
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const SHOTS = 'test-results/screenshots';

// Load the app, capture any page/console errors, wait until it's interactive.
async function gotoApp(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__app);
  await page.waitForTimeout(400);
  return errors;
}

test('loads and renders a non-blank scene', async ({ page }) => {
  const errors = await gotoApp(page);
  // preserveDrawingBuffer is on, so read the last frame straight from the GL context.
  const brightPixels = await page.evaluate(() => {
    const gl = window.__app.renderer.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 80) n++;
    return n;
  });
  expect(brightPixels).toBeGreaterThan(2000);   // the puzzle actually drew
  expect(errors).toEqual([]);
});

test('survives turns, shuffle, recenter, and view modes without errors', async ({ page }) => {
  const errors = await gotoApp(page);
  await page.evaluate(async () => {
    const a = window.__app;
    // Wait until nothing is animating, centering, or shuffling.
    const settled = () => new Promise(r => {
      const t = setInterval(() => {
        if (a.anim.isIdle() && !a.shuffling && !a.pendingCenter) { clearInterval(t); r(); }
      }, 25);
    });
    a.anim.speedFactor = 4;                       // run animations fast for the test
    a.executeMove(2, 'XW', +1); await settled();  // depth-involving turn
    a.executeMove(0, 'YZ', -1); await settled();
    a.turnScreenPlane(0, 2, +1); await settled(); // a centred-cell twist via the button path
    a.shuffle();                await settled();  // one-shot shuffle (20 turns, full speed)
    a.selectCentralCell(5);     await settled();  // recentering
    a.selectCentralCell(0);     await settled();
    a.setViewMode('total-wire');
    a.executeMove(4, 'XY', +1); await settled();  // turn in total-wireframe mode
    a.setViewMode('shell-wire');
    a.resetPuzzle();
  });
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('central-cell switching is stable (returns to the same orientation)', async ({ page }) => {
  await gotoApp(page);
  const stable = await page.evaluate(async () => {
    const a = window.__app;
    const settled = () => new Promise(r => {
      const t = setInterval(() => {
        if (a.anim.isIdle() && !a.shuffling && !a.pendingCenter) { clearInterval(t); r(); }
      }, 25);
    });
    a.anim.speedFactor = 6;
    const start = JSON.stringify(a.coreFrame);     // canonical frame for cell 0 at boot
    for (const c of [5, 2, 7, 0]) { a.selectCentralCell(c); await settled(); }
    return JSON.stringify(a.coreFrame) === start;   // round-trip lands exactly back
  });
  expect(stable).toBe(true);
});

test('persists puzzle, central cell, and settings across a reload', async ({ page }) => {
  const errors = await gotoApp(page);
  // Mutate every persisted facet, then let the debounced save flush on reload.
  const before = await page.evaluate(async () => {
    const a = window.__app;
    const settled = () => new Promise(r => {
      const t = setInterval(() => {
        if (a.anim.isIdle() && !a.shuffling && !a.pendingCenter) { clearInterval(t); r(); }
      }, 25);
    });
    a.anim.speedFactor = 4;
    a.executeMove(2, 'XW', +1); await settled();
    a.executeMove(0, 'YZ', -1); await settled();
    a.selectCentralCell(5);     await settled();
    a.setViewMode('total-wire');
    a.setControlSet('both');
    document.getElementById('speed-slider').value = 8;
    document.getElementById('speed-slider').dispatchEvent(new Event('input'));
    a._scheduleSave.flush();                       // force the pending write out now
    return {
      cubies: JSON.stringify(a.cubies.map(c => Array.from(c.pos4))),
      central: a.centralCellIndex,
      viewMode: a.viewMode,
      controlSet: a.controlSet,
      speed: parseInt(document.getElementById('speed-slider').value),
    };
  });

  await page.reload();
  await page.waitForFunction(() => !!window.__app);
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const a = window.__app;
    return {
      cubies: JSON.stringify(a.cubies.map(c => Array.from(c.pos4))),
      central: a.centralCellIndex,
      viewMode: a.viewMode,
      controlSet: a.controlSet,
      speed: parseInt(document.getElementById('speed-slider').value),
      speedFactor: a.anim.speedFactor,
    };
  });

  expect(after.cubies).toBe(before.cubies);
  expect(after.central).toBe(before.central);
  expect(after.viewMode).toBe(before.viewMode);
  expect(after.controlSet).toBe(before.controlSet);
  expect(after.speed).toBe(before.speed);
  expect(after.speedFactor).toBeCloseTo(before.speed / 5);
  expect(errors).toEqual([]);
});

test('captures reference screenshots', async ({ page }) => {
  await gotoApp(page);
  await mkdir(SHOTS, { recursive: true });
  const canvas = page.locator('#glcanvas');
  await writeFile(`${SHOTS}/idle.png`, await canvas.screenshot());
  await page.evaluate(() => window.__app.setViewMode('total-wire'));
  await page.waitForTimeout(200);
  await writeFile(`${SHOTS}/wireframe.png`, await canvas.screenshot());
});
