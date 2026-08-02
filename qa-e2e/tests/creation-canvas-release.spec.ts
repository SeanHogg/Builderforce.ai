import { expect, test, type Page } from '@playwright/test';

test.skip(!!process.env.BF_PROJECT_ID, 'Builderforce product conformance; skipped in customer-project mode');

async function openLocalCanvas(page: Page) {
  await page.goto('/create/new');
  await expect(page).toHaveURL(/\/create\/(?:local-)?[a-f0-9-]+/);
  await expect(page.getByRole('textbox', { name: /session title/i })).toBeVisible();
}

test.describe('Creation Canvas deployed product matrix', () => {
  test('tutorial, template library, structured graph, and Brain change review work without a project', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await openLocalCanvas(page);

    await page.getByRole('button', { name: /tutorial/i }).click();
    await expect(page.getByText(/1 of 6/i)).toBeVisible();
    await page.getByRole('button', { name: /dismiss/i }).click();

    await page.getByRole('button', { name: /more session actions/i }).click();
    await page.getByRole('button', { name: /^templates$/i }).click();
    await expect(page.getByText('Campaign studio', { exact: true })).toBeVisible();
    await page.getByText('Product discovery', { exact: true }).click();
    await expect(page.getByText('Top requested features', { exact: true })).toBeVisible();

    const outline = page.getByText(/accessible canvas outline/i);
    await outline.click();
    await expect(page.getByRole('button', { name: /focus .*workflow/i }).first()).toBeVisible();

    const composer = page.getByRole('textbox', { name: /ask brain about this canvas/i });
    await composer.fill('Evaluate this campaign workflow and landing page, then propose improvements');
    await page.getByRole('button', { name: /send to brain/i }).click();
    await expect(page.getByText(/review brain changes/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /apply \d+ selected/i })).toBeEnabled();
    await page.getByRole('button', { name: /apply \d+ selected/i }).click();
    await expect(page.getByText(/reviewed brain changes applied/i)).toBeVisible();
    await context.close();
  });

  test('Workflow and Voice remain editable surfaces inside the Canvas session', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await openLocalCanvas(page);

    await page.getByRole('button', { name: /focus fall campaign workflow/i }).click();
    await page.getByRole('button', { name: /edit workflow on canvas/i }).click();
    await expect(page.getByRole('dialog', { name: /workflow focus editor/i })).toBeVisible();
    await page.getByRole('button', { name: /close workflow editor/i }).click();

    await page.getByRole('button', { name: /toggle object palette/i }).click();
    await page.getByRole('button', { name: /^voice$/i }).click();
    await expect(page.getByText(/voice studio/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /dictate and transcribe script/i })).toBeVisible();
    await context.close();
  });

  test('keyboard, reduced-motion, high-contrast, zoom, and 360px review remain usable', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: undefined,
      reducedMotion: 'reduce',
      forcedColors: 'active',
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();
    await openLocalCanvas(page);
    await page.evaluate(() => { document.body.style.zoom = '200%'; });

    const title = page.getByRole('textbox', { name: /session title/i });
    await title.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /ask brain about this canvas/i })).toBeVisible();
    await expect(page.getByText(/accessible canvas outline/i)).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
    await context.close();
  });

  test('authenticated Dashboard creates, lists, and reopens a durable Session', async ({ page }) => {
    const title = `E2E restore ${Date.now()}`;
    await page.goto('/create/new');
    await expect(page).toHaveURL(/\/create\/(?!local-)[a-f0-9-]+/);
    await page.getByRole('textbox', { name: /session title/i }).fill(title);
    await page.getByRole('textbox', { name: /session title/i }).blur();
    await expect(page.getByText(/saved/i)).toBeVisible();

    await page.goto('/dashboard');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.getByText(title, { exact: true }).click();
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue(title);
  });

  test('legacy Brainstorm entry adapts into the canonical Canvas route', async ({ page }) => {
    await page.goto('/brainstorm?prompt=Build%20a%20new%20website');
    await expect(page).toHaveURL(/\/create\/(?:local-)?[a-f0-9-]+.*from=brainstorm/, { timeout: 20_000 });
    await expect(page.getByRole('textbox', { name: /ask brain about this canvas/i })).toBeVisible();
  });
});
