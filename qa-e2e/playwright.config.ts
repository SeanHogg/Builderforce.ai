import { defineConfig, devices } from '@playwright/test';
import { baseUrl } from './src/bf';

/**
 * Authenticated smoke suite against the deployed Builderforce app.
 * globalSetup mints the session; every test inherits storageState so it runs
 * logged-in. The JSON reporter feeds src/report.ts, which posts results back to
 * /api/qa/runs.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'results.json' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: baseUrl(),
    storageState: process.env.BF_STORAGE_STATE ?? '.auth/state.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
