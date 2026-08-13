import { test, expect } from '@playwright/test';

/**
 * Creation Canvas conformance.
 *
 * ── WHY THESE SELECT BY TEST ID ──────────────────────────────────────────────
 * This file used to select by accessible name — `/session title/i`, `/ask brain/i`,
 * `/send to brain/i`. Both consequences were silent: the suite could only ever pass
 * in English, in a product that ships five locales, and any copy edit turned it red
 * with no behaviour change. The canvas now carries stable `data-testid`s on the
 * board, the composer, the palette and every node, so these assert BEHAVIOUR and
 * survive both a re-word and a locale switch.
 *
 * Where a test genuinely asserts COPY (the guest gate wording), it says so and uses
 * text on purpose.
 */

test.skip(!!process.env.BF_PROJECT_ID, 'Builderforce product conformance; skipped in customer-project mode');

test('anonymous homepage prompt opens an unrestricted local Creation Session', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('textbox', { name: /ai workforce|create|describe/i }).fill('Build a new website');
  await page.getByRole('button', { name: /get started/i }).click();
  await expect(page).toHaveURL(/\/create\/local-[a-f0-9-]+$/);
  await expect(page.getByTestId('canvas-session-title')).toHaveValue('Build a new website');
  await expect(page.getByTestId('canvas-composer')).toBeVisible();
  await expect(page.getByText(/assigned resources|required project/i)).toHaveCount(0);
  const persisted = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('builderforce:create:local-')));
  expect(persisted).toBe(true);
  await context.close();
});

test('signed-in user can create and reopen a durable Canvas Session', async ({ page }) => {
  await page.goto('/create/new');
  await expect(page).toHaveURL(/\/create\/(?!local-)[a-f0-9-]+/);
  await expect(page.getByTestId('canvas-session-title')).toBeVisible();
  await expect(page.getByRole('button', { name: /invite collaborator/i })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('canvas-session-title')).toBeVisible();
  await expect(page.getByTestId('canvas-composer')).toBeVisible();
});

test('the QA objects are in the palette and land on the board', async ({ page }) => {
  await page.goto('/create/new');
  await expect(page.getByTestId('canvas-session-title')).toBeVisible();

  const palette = page.getByTestId('canvas-palette');
  if (!(await palette.isVisible())) await page.getByRole('button', { name: /object palette/i }).click();
  await expect(palette).toBeVisible();

  // The palette search matches on KIND as well as on the localized label, so
  // filtering here stays locale-independent.
  await page.getByTestId('canvas-palette-search').fill('quality');
  for (const kind of ['testPlan', 'testCase', 'testRun', 'defect']) {
    await expect(page.getByTestId(`canvas-palette-${kind}`), `${kind} is offered`).toBeVisible();
  }

  await page.getByTestId('canvas-palette-testPlan').click();
  await expect(page.getByTestId('canvas-node-testPlan')).toBeVisible();
});
