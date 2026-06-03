import { defineConfig, devices } from '@playwright/test';

// `npm test` boots the dev server itself (reusing one if already running),
// so a fresh clone needs only `npm install && npx playwright install chromium`.
export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8791',
    viewport: { width: 1100, height: 780 },
  },
  webServer: {
    command: 'node scripts/serve.js',
    url: 'http://localhost:8791/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
