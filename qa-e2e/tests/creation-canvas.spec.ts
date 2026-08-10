import { test, expect } from '@playwright/test';

test.skip(!!process.env.BF_PROJECT_ID, 'Builderforce product conformance; skipped in customer-project mode');

test('anonymous homepage prompt opens an unrestricted local Creation Session', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('textbox', { name: /ai workforce|create|describe/i }).fill('Build a new website');
  await page.getByRole('button', { name: /get started/i }).click();
  await expect(page).toHaveURL(/\/create\/local-[a-f0-9-]+$/);
  await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Build a new website');
  await expect(page.getByRole('textbox', { name: /ask brain/i })).toBeVisible();
  await expect(page.getByText(/assigned resources|required project/i)).toHaveCount(0);
  const persisted = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('builderforce:create:local-')));
  expect(persisted).toBe(true);
  await context.close();
});

test('signed-in user can create and reopen a durable Canvas Session', async ({ page }) => {
  await page.goto('/create/new');
  await expect(page).toHaveURL(/\/create\/(?!local-)[a-f0-9-]+/);
  await expect(page.getByRole('textbox', { name: /session title/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /invite collaborator/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: /session title/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /send to brain/i })).toBeVisible();
});
