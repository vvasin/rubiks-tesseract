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

test('survives turns, scramble, recenter, and wireframe without errors', async ({ page }) => {
  const errors = await gotoApp(page);
  await page.evaluate(async () => {
    const a = window.__app;
    const idle = () => new Promise(r => {
      const t = setInterval(() => { if (a.anim.isIdle()) { clearInterval(t); r(); } }, 25);
    });
    a.anim.speedFactor = 4;                       // run animations fast for the test
    a.executeMove(2, 'XW', +1); await idle();     // depth-involving turn
    a.executeMove(0, 'YZ', -1); await idle();
    a.startScramble();                             // looping scramble
    await new Promise(r => setTimeout(r, 800));    // let it run a few rounds
    a.stopScramble();           await idle();
    a.selectCentralCell(5);     await idle();      // recentering
    a.selectCentralCell(0);     await idle();
    a.setWire(true);
    a.executeMove(4, 'XY', +1); await idle();      // turn in wireframe mode
    a.setWire(false);
    a.resetPuzzle();
  });
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

test('captures reference screenshots', async ({ page }) => {
  await gotoApp(page);
  await mkdir(SHOTS, { recursive: true });
  const canvas = page.locator('#glcanvas');
  await writeFile(`${SHOTS}/idle.png`, await canvas.screenshot());
  await page.evaluate(() => window.__app.setWire(true));
  await page.waitForTimeout(200);
  await writeFile(`${SHOTS}/wireframe.png`, await canvas.screenshot());
});
