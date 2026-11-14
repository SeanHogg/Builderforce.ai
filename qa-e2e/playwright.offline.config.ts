/**
 * Anonymous-only Playwright config — no global setup, no stored session.
 *
 * Used by the PRD 41 §A6 packaged offline acceptance scenario
 * (`tests/vsix-offline-acceptance.spec.ts`). That scenario is a self-contained
 * VS Code launch with all egress denied: it needs no browser base URL, no
 * authenticated session, and none of the global-setup.ts login work.
 *
 *   pnpm tsx src/a6-offline.ts -- --small
 *   # or directly:
 *   npx playwright test tests/vsix-offline-acceptance.spec.ts -c playwright.anon.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
