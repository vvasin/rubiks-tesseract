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

test('swipe across the centred cube turns a layer; background swipe orbits', async ({ page }) => {
  const errors = await gotoApp(page);

  // The interaction surface tracks the projection: ~27 visible stickers on the 3 front faces.
  const meta = await page.evaluate(() => {
    const st = window.__app.centralStickers();
    return { count: st.length, faces: [...new Set(st.map(s => s.a + ':' + s.sa))].length };
  });
  expect(meta.count).toBeGreaterThanOrEqual(24);
  expect(meta.count).toBeLessThanOrEqual(27);
  expect(meta.faces).toBe(3);

  // A drag from one sticker to an in-line neighbour issues a layer turn.
  const pts = await page.evaluate(() => {
    const st = window.__app.centralStickers();
    const ctr = s => { let x = 0, y = 0; for (const p of s.poly) { x += p.x; y += p.y; } return { x: x / 4, y: y / 4 }; };
    for (const s of st) for (const o of st) {
      if (o === s || o.a !== s.a || o.sa !== s.sa) continue;
      const d0 = o.g[s.t[0]] - s.g[s.t[0]], d1 = o.g[s.t[1]] - s.g[s.t[1]];
      if ((Math.abs(d0) === 1) !== (Math.abs(d1) === 1)) return { from: ctr(s), to: ctr(o) };
    }
    return null;
  });
  expect(pts).not.toBeNull();

  const before = await page.evaluate(() => JSON.stringify(window.__app.cubies.map(c => [...c.pos4])));
  await page.mouse.move(pts.from.x, pts.from.y);
  await page.mouse.down();
  await page.mouse.move((pts.from.x + pts.to.x) / 2, (pts.from.y + pts.to.y) / 2);
  await page.mouse.move(pts.to.x, pts.to.y);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterTurn = await page.evaluate(() => JSON.stringify(window.__app.cubies.map(c => [...c.pos4])));
  expect(afterTurn).not.toBe(before);

  // A drag starting on the background (a stage corner) orbits the view and leaves the puzzle alone.
  const bg = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left + 6, y: r.top + 6, yaw: window.__app.viewYaw };
  });
  await page.mouse.move(bg.x, bg.y);
  await page.mouse.down();
  await page.mouse.move(bg.x + 60, bg.y + 30);
  await page.mouse.up();
  const res = await page.evaluate(() => ({
    yaw: window.__app.viewYaw,
    cubies: JSON.stringify(window.__app.cubies.map(c => [...c.pos4])),
  }));
  expect(res.yaw).not.toBe(bg.yaw);
  expect(res.cubies).toBe(afterTurn);   // orbit didn't move the puzzle
  expect(errors).toEqual([]);
});

test('a swipe that exits the start sticker off the cube still turns (exit-direction model)', async ({ page }) => {
  const errors = await gotoApp(page);
  await page.evaluate(() => window.__app.resetPuzzle());

  // Start on a face-centre sticker and drag straight outward, ending well OUTSIDE the cube
  // (and outside any sticker). The exit edge alone should resolve the turn.
  const sw = await page.evaluate(() => {
    const st = window.__app.centralStickers();
    const s = st.find(x => x.g[x.t[0]] === 0 && x.g[x.t[1]] === 0) || st[0];   // a face centre
    const ctr = p => ({ x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4, y: (p[0].y + p[1].y + p[2].y + p[3].y) / 4 });
    const c = ctr(s.poly);
    // +t0 screen direction (opposite edge midpoints); push 4× a cell out, far past the cube.
    const ux = (s.poly[1].x + s.poly[2].x - s.poly[0].x - s.poly[3].x) / 2;
    const uy = (s.poly[1].y + s.poly[2].y - s.poly[0].y - s.poly[3].y) / 2;
    return { cx: c.x, cy: c.y, ex: c.x + ux * 4, ey: c.y + uy * 4 };
  });

  const before = await page.evaluate(() => JSON.stringify(window.__app.cubies.map(c => [...c.pos4])));
  await page.mouse.move(sw.cx, sw.cy);
  await page.mouse.down();
  await page.mouse.move((sw.cx + sw.ex) / 2, (sw.cy + sw.ey) / 2);
  await page.mouse.move(sw.ex, sw.ey);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.stringify(window.__app.cubies.map(c => [...c.pos4])));
  expect(after).not.toBe(before);
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
