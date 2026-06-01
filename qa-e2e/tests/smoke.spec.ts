import { test, expect } from '@playwright/test';

/**
 * Baseline authenticated smoke test — always present, independent of generation.
 * Confirms the session injection works and core authenticated routes render
 * without bouncing to /login or hitting an error boundary. If THIS fails, the
 * generated suite's failures are environmental (auth/deploy), not real defects.
 *
 * Self-test only: these routes are Builderforce's own. In project mode the suite
 * is entirely the generated per-persona specs, so skip this baseline.
 */
test.skip(!!process.env.BF_PROJECT_ID, 'self-test baseline; skipped in project mode');

const ROUTES = ['/dashboard', '/projects', '/settings'];

for (const route of ROUTES) {
  test(`authenticated route loads: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);
    await expect(page.locator('body')).toBeVisible();
  });
}
