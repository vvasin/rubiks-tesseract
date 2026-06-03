# Rubik's Tesseract

Interactive WebGL visualization of a **3×3×3×3 Rubik's tesseract**. Vanilla JS + WebGL 1.0,
no build step, no runtime dependencies.

## Setup (fresh machine)

```bash
npm install
npx playwright install chromium    # browser used by the tests
```

## Run

```bash
npm start                          # serves at http://localhost:8791
```

Then open http://localhost:8791/. The page loads `src/*.js` as ES modules directly — there
is **no bundler or build step**.

## Test & lint

```bash
npm test                           # Playwright end-to-end (auto-starts the dev server)
npm run lint                       # ESLint
```

Tests live in `tests/`; they drive the real app and assert it renders and survives every
interaction without console errors. Reference screenshots are written to
`test-results/screenshots/` (gitignored) for manual inspection.

## Layout

```
index.html, style.css     entry point + styles
src/                       app source (ES modules)
scripts/serve.js           zero-dependency static dev server
tests/                     Playwright specs
playwright.config.js       test runner config (boots the dev server)
eslint.config.js           lint config
CLAUDE.md                  architecture & design rationale — read this before changing rendering
```

See [CLAUDE.md](CLAUDE.md) for the projection model and the reasoning behind the
non-obvious rendering decisions.
