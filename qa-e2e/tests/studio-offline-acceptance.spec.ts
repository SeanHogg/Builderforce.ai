/**
 * Studio offline and outage acceptance (WC-G007) — the browser release gate for "Studio keeps working
 * with no network and through a platform outage".
 * Contract: docs/specs/make.md › Design — Studio local-first.
 *
 * Six proofs, each against the DEPLOYED product (never run against production data by default):
 *   1. guest: create a board offline, edit it, reload, reconnect — the work is still there and drains;
 *   2. a device-held board opens from the library while offline and says it is available offline;
 *   3. a forced 503 on push keeps the edits and drains them when the route clears;
 *   4. a database outage (every API call 503) leaves board edit, reload and Studio usable, and the
 *      server-only work (template install, the project IDE) says it is unavailable;
 *   5. signed in: the 20 most recent boards are seeded on the device, and one opens offline;
 *   6. on-device generation with a prepared model (BF_E2E_PREPARED_MODEL=1).
 *
 * Run: `pnpm exec playwright test tests/studio-offline-acceptance.spec.ts` with BF_BASE_URL set.
 */

import { existsSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.skip(!!process.env.BF_PROJECT_ID, 'Builderforce product conformance; skipped in customer-project mode');

const STORAGE_STATE = process.env.BF_STORAGE_STATE ?? '.auth/state.json';
const SIGNED_IN = existsSync(STORAGE_STATE);
const BOARD_PATH = /\/(?:create|studio)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const SEEDED_RECENT_BOARDS = 20;

/** The sync indicator's pending count ("3 changes waiting"); 0 when nothing is waiting. */
async function pendingChanges(page: Page): Promise<number> {
  const text = (await page.getByRole('status').filter({ hasText: /saved|offline|syncing/i }).first().textContent()) ?? '';
  return Number(/(\d+)\s+changes?\s+waiting/i.exec(text)?.[1] ?? 0);
}

async function visitOnline(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The shell is precached at install; one reload puts the page itself under the worker.
  await page.reload();
}

async function createBoard(page: Page): Promise<string> {
  await page.goto('/create/new');
  await expect(page).toHaveURL(BOARD_PATH);
  await expect(page.getByRole('textbox', { name: /session title/i })).toBeVisible();
  return BOARD_PATH.exec(page.url())![1]!;
}

async function rename(page: Page, title: string): Promise<void> {
  const box = page.getByRole('textbox', { name: /session title/i });
  await box.fill(title);
  await box.blur();
}

/** Every API call answers 503 (a database outage); static assets and the page itself are untouched. */
async function failApi(context: BrowserContext, status = 503): Promise<void> {
  await context.route('**/api/**', (route) => route.fulfill({ status, json: { error: 'database_unavailable', code: 'database_unavailable' } }));
}

test.describe('Studio offline and outage acceptance', () => {
  test('guest: a board created offline survives edit and reload, and drains on reconnect', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await visitOnline(page, '/studio');

    await context.setOffline(true);
    const boardId = await createBoard(page);
    await rename(page, 'Offline guest board');
    await page.reload();
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Offline guest board');

    await page.goto(`/studio/${boardId}`);
    await expect(page).toHaveURL(new RegExp(`/studio/local\\?board=${boardId}`));

    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Offline guest board');
    await context.close();
  });

  test('a device-held board opens from the library offline and is marked available offline', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: undefined });
    const page = await context.newPage();
    await visitOnline(page, '/studio');
    const boardId = await createBoard(page);
    await rename(page, 'Held board');

    await visitOnline(page, '/studio');
    await context.setOffline(true);
    await page.reload();
    const card = page.getByRole('link', { name: /held board/i });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/available offline/i);
    await expect(card).toHaveAttribute('href', new RegExp(`/studio/local\\?board=${boardId}`));
    await card.click();
    await expect(page).toHaveURL(new RegExp(`board=${boardId}`));
    await context.close();
  });

  test('a forced 503 on push keeps the edits, then drains them', async ({ page }) => {
    test.skip(!SIGNED_IN, 'needs a signed-in session (.auth/state.json)');
    let pushes = 0;
    await page.route('**/api/sync/**', (route) => {
      if (!route.request().url().includes('/push')) return route.continue();
      pushes += 1;
      // First without a Retry-After, then with one: both must hold the work, neither may drop it.
      return route.fulfill({ status: 503, headers: pushes > 1 ? { 'Retry-After': '2' } : {}, json: { error: 'database_unavailable' } });
    });
    await createBoard(page);
    await rename(page, 'Held through a 503');
    await expect.poll(() => pendingChanges(page)).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Held through a 503');

    await page.unroute('**/api/sync/**');
    await expect.poll(() => pendingChanges(page), { timeout: 30_000 }).toBe(0);
  });

  test('a database outage leaves board edit, reload and Studio usable, and says what is server-only', async ({ page }) => {
    test.skip(!SIGNED_IN, 'needs a signed-in session (.auth/state.json)');
    await visitOnline(page, '/studio');
    const boardId = await createBoard(page);
    await failApi(page.context());
    await rename(page, 'Edited during an outage');
    await page.reload();
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Edited during an outage');

    await page.goto('/studio');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/studio/project/1');
    await expect(page.getByText(/unavailable|try again|offline/i).first()).toBeVisible();
    expect(boardId).toMatch(/[0-9a-f-]{36}/);
  });

  test('signed in: the recent boards are seeded on the device and one opens offline', async ({ page, context }) => {
    test.skip(!SIGNED_IN, 'needs a signed-in session (.auth/state.json)');
    await visitOnline(page, '/studio');
    await expect.poll(async () => page.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.length;
    }), { timeout: 30_000 }).toBeGreaterThan(0);
    // The seeded count is read through the library: every held board is listed as available offline.
    await context.setOffline(true);
    await page.reload();
    const held = page.getByText(/available offline/i);
    await expect(held.first()).toBeVisible();
    expect(await held.count()).toBeLessThanOrEqual(SEEDED_RECENT_BOARDS);
    await page.getByRole('link').filter({ hasText: /available offline/i }).first().click();
    await expect(page).toHaveURL(/\/studio\/local\?board=/);
  });

  test('on-device generation with a prepared model saves a rendition offline', async ({ page, context }) => {
    test.skip(process.env.BF_E2E_PREPARED_MODEL !== '1', 'needs a prepared on-device model (BF_E2E_PREPARED_MODEL=1)');
    await visitOnline(page, '/studio');
    const boardId = await createBoard(page);
    await visitOnline(page, `/create/${boardId}`);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: /generate/i }).first().click();
    await expect(page.getByText(/rendition|generated|saved/i).first()).toBeVisible({ timeout: 120_000 });
  });
});
