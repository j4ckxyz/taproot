import { defineConfig, devices } from '@playwright/test';

// End-to-end tests in a real browser, against a fresh server with its own data folder.
// Run with `npm run test:e2e` (builds first). They cover the things unit tests can't:
// focus, double-clicks, keyboard flows, menus and live sync between tabs and agents.

const PORT = 8790;
const DATA = `${process.env.RUNNER_TEMP ?? '/tmp'}/taproot-e2e-${Date.now()}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  globalTimeout: 10 * 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 880 },
    trace: 'retain-on-failure',
  },
  // Real Chrome (locally) or the full Chromium build (CI) use the same headless mode as desktop
  // Chrome, which matters for pointer-capture and double-click behaviour.
  // Locally it uses your installed Google Chrome; set E2E_CHANNEL=chromium to use Playwright's.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.E2E_CHANNEL ?? (process.env.CI ? 'chromium' : 'chrome'), viewport: { width: 1400, height: 880 } },
    },
  ],
  webServer: {
    command: `node dist/server/index.js`,
    url: `http://localhost:${PORT}/healthz`,
    env: { PORT: String(PORT), DATA_DIR: DATA, UPDATE_CHECK: 'false' },
    reuseExistingServer: false,
  },
});
