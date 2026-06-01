import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { baseUrl, projectId } from './src/bf';

/**
 * Authenticated smoke suite.
 *  - Self-test mode: globalSetup mints one Builderforce session; storageState
 *    is shared by every spec.
 *  - Project mode (BF_PROJECT_ID): pull-tests logs in each persona and injects
 *    a per-spec `test.use({ storageState })`, so the config supplies none.
 *
 * baseURL comes from .auth/config.json (written by pull-tests — the project's
 * target URL or the self-test base URL), falling back to BF_BASE_URL.
 */
function resolvedBaseUrl(): string {
  try {
    if (existsSync('.auth/config.json')) {
      const cfg = JSON.parse(readFileSync('.auth/config.json', 'utf8')) as { baseUrl?: string };
      if (cfg.baseUrl) return cfg.baseUrl;
    }
  } catch {
    /* fall through */
  }
  return baseUrl();
}

const isProjectMode = projectId() != null;

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
    baseURL: resolvedBaseUrl(),
    // Project mode: each generated spec declares its own persona storageState.
    // Self-test mode: share the single session minted by global-setup.
    ...(isProjectMode ? {} : { storageState: process.env.BF_STORAGE_STATE ?? '.auth/state.json' }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
