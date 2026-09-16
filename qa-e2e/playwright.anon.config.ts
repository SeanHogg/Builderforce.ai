/**
 * Anonymous-only Playwright config — no global setup, no stored session.
 *
 * The Creation Canvas conformance specs (`tests/creation-canvas.spec.ts`) each
 * mint their OWN `browser.newContext()` and exercise the logged-OUT canvas, so
 * the authenticated session the default config mints in `global-setup.ts` is
 * both unnecessary and an obstacle: it demands BF_QA_EMAIL/BF_QA_PASSWORD that
 * a local developer run does not have.
 *
 * Use this to run the canvas release gate against a local dev server:
 *   BF_BASE_URL=http://localhost:3000 npx playwright test \
 *     tests/creation-canvas.spec.ts -c playwright.anon.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

function resolvedBaseUrl(): string {
  return (process.env.BF_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: resolvedBaseUrl(),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
