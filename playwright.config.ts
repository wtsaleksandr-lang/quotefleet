import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';

/* Auto-detect Nix-managed Chromium on Replit (Playwright's bundled
 * headless shell is incompatible with Replit's system libs). Falls
 * back to the bundled browser locally. */
function findChromium(): string | undefined {
  try {
    const out = execSync(
      'which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null',
      { encoding: 'utf-8' }
    ).trim();
    if (out) return out;
  } catch { /* fall through */ }
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  return undefined;
}

const chromiumPath = findChromium();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    browserName: 'chromium',
    headless: true,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5000',
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },

  /*
   * Replit usage (recommended):
   *   1. Start the dev server in one shell tab: pnpm dev
   *   2. Run tests in another tab:               pnpm test:e2e
   * The reuseExistingServer flag below keeps Playwright from clobbering
   * a server that's already running with Replit Secrets injected.
   *
   * Local / CI usage: just `pnpm test:e2e` — Playwright will start the
   * dev server itself, but won't have access to Replit-injected secrets.
   */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5000/healthz',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
