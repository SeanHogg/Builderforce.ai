import { expect, test, type Page } from '@playwright/test';

test.skip(!!process.env.BF_PROJECT_ID, 'Builderforce product conformance; skipped in customer-project mode');

async function openLocalCanvas(page: Page) {
  await page.goto('/create/new');
  await expect(page).toHaveURL(/\/create\/(?:local-)?[a-f0-9-]+/);
  await expect(page.getByRole('textbox', { name: /session title/i })).toBeVisible();
}

test.describe('Creation Canvas deployed product matrix', () => {
  test('Website publish and Video generation execute adapters and surface terminal deliverables', async ({ page }) => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const websiteId = '22222222-2222-4222-8222-222222222222';
    const projectObjectId = '33333333-3333-4333-8333-333333333333';
    const videoId = '44444444-4444-4444-8444-444444444444';
    let publishedAssets = false;
    let generatedVideo = false;

    await page.route('**/api/creation-sessions/quotas', (route) => route.fulfill({ json: { usage: { sessions: 1, templates: 0 }, limits: { sessions: 20, collaboratorsPerSession: 10, templates: 10, historyPerSession: 50, datasetRows: 500, realtimeEditors: 10, artifactBytesPerSession: 10_000_000 } } }));
    await page.route(`**/api/creation-sessions/${sessionId}*`, async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.includes('/timeline')) return route.fulfill({ json: request.method() === 'GET' ? { messages: [], lastId: 0, hasMore: false } : { id: 1, clientMessageId: 'e2e', messageRole: 'system', body: 'saved', metadata: {}, createdBy: null, createdAt: new Date().toISOString() } });
      if (url.includes('/outcomes')) return route.fulfill({ json: { recorded: true, duplicate: false } });
      if (url.includes('/presence')) return route.fulfill({ json: { revision: 1, currentUserId: 'e2e-user', members: [] } });
      if (url.includes('/graph')) return route.fulfill({ json: { revision: 2, savedAt: new Date().toISOString() } });
      if (request.method() !== 'GET') return route.fulfill({ json: {} });
      return route.fulfill({ json: {
        session: { id: sessionId, title: 'Delivery E2E', description: null, status: 'active', preview: null, revision: 1, canvasRevision: 1, lastActivityAt: new Date().toISOString(), createdAt: new Date().toISOString(), role: 'owner' },
        role: 'owner', currentUserId: 'e2e-user', projectIds: [77], members: [], personalViewport: null,
        objects: [
          { id: websiteId, kind: 'website', resourceType: null, resourceId: null, canvasData: { x: 120, y: 120 }, content: { title: 'Launch site', websiteHeadline: 'Ship the idea', websiteBody: 'A real deployed outcome.', websiteCta: 'Begin', websiteAccent: '#3978f6' } },
          { id: projectObjectId, kind: 'project', resourceType: 'project', resourceId: '77', canvasData: { x: 560, y: 120 }, content: { title: 'Launch project', status: 'Active' } },
          { id: videoId, kind: 'video', resourceType: null, resourceId: null, canvasData: { x: 120, y: 560 }, content: { title: 'Launch video', prompt: 'A bright product reveal', maxFrames: 1 } },
        ],
        connections: [{ id: '55555555-5555-4555-8555-555555555555', sourceObjectId: websiteId, targetObjectId: projectObjectId, kind: 'delivery', label: 'publishes' }],
      } });
    });
    await page.route('**/api/ide/projects/77/publish', async (route) => {
      publishedAssets = (await route.request().postDataBuffer())?.includes(Buffer.from('index.html')) === true;
      return route.fulfill({ json: { subdomain: 'delivery-e2e', versionToken: 'v1', assetCount: 2, totalBytes: 2048, url: 'https://delivery-e2e.builderforce.ai', pathUrl: 'https://builderforce.ai/sites/delivery-e2e' } });
    });
    await page.route('**/api/llm/models', (route) => route.fulfill({ json: { models: [{ slug: 'video-e2e', name: 'Video E2E', baseModel: 'evermind/fixture' }] } }));
    await page.route('**/api/studio/models/video-e2e/generate-media', (route) => {
      generatedVideo = true;
      return route.fulfill({ json: { model: 'evermind/fixture', modality: 'video', width: 1, height: 1, channels: 3, frameCount: 1, frames: ['//8A'], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } } });
    });

    await page.goto(`/create/${sessionId}`);
    await expect(page.getByRole('textbox', { name: /session title/i })).toHaveValue('Delivery E2E');
    await page.getByText(/accessible canvas outline/i).click();
    await page.getByRole('button', { name: /focus launch site/i }).click();
    await page.getByRole('button', { name: /publish live website/i }).click();
    await expect(page.getByRole('link', { name: /open published site/i })).toBeVisible();
    await expect(page.getByLabel('Deliverables').getByText(/website.*delivered/i)).toBeVisible();
    expect(publishedAssets).toBe(true);

    await page.getByRole('button', { name: /focus launch video/i }).click();
    await page.getByRole('button', { name: /generate video/i }).click();
    await expect(page.getByLabel('Deliverables').getByText(/video.*delivered/i)).toBeVisible();
    expect(generatedVideo).toBe(true);
  });

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
