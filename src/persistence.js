// Session persistence — puzzle state, central cell, and settings survive a refresh or a
// reopened tab. We keep this best-effort: any storage/parse failure is swallowed (private
// mode, quota, corrupted blob) and the app falls back to a fresh solved puzzle.
//
// Saves are debounced (see `debounce`) so a burst of turns / a shuffle coalesces into a
// single write, and flushed on pagehide so the last move isn't lost.

const STORAGE_KEY = 'rubiks-tesseract/state/v1';

export function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable or full — persistence is best-effort, so ignore. */
  }
}

// Debounce a zero-arg function. The returned function delays the call by `ms`, resetting
// the timer on each invocation; `.flush()` runs any pending call immediately (for pagehide).
export function debounce(fn, ms) {
  let timer = null;
  const run = () => { timer = null; fn(); };
  const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(run, ms); };
  debounced.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  return debounced;
}
