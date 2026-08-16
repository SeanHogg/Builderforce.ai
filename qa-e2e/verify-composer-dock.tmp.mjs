import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = 'C:\\Users\\seanh\\AppData\\Local\\Temp\\claude\\c--code-agentic\\b98c1186-c7dd-4650-84cc-37bb5204d56b\\scratchpad';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

const sessionId = `local-verify-${Date.now()}`;
await page.goto(`http://localhost:3000/create/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

await page.getByLabel('Ask Brain about this canvas').waitFor({ timeout: 30000 });
await page.screenshot({ path: path.join(OUT, '01-initial.png') });

// Dismiss the first-visit guided-tour offer if it appeared — it veils the canvas
// and intercepts clicks until closed.
if (await page.getByRole('dialog', { name: /guided tour/i }).isVisible().catch(() => false)) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// Switch to the App surface tab.
await page.getByRole('button', { name: 'App' }).first().click({ force: true });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '02-app-surface.png') });

// Ensure the Brain dock is open and docked left.
const openDockBtn = page.getByRole('button', { name: 'Show Brain chat' });
if (await openDockBtn.isVisible().catch(() => false)) {
  await openDockBtn.click({ force: true });
  await page.waitForTimeout(300);
}
const dockLeftBtn = page.getByRole('button', { name: 'Dock Brain to the left' });
if (await dockLeftBtn.isVisible().catch(() => false)) {
  await dockLeftBtn.click({ force: true });
  await page.waitForTimeout(300);
}
await page.screenshot({ path: path.join(OUT, '03-brain-docked-left.png') });

// Dock the composer/prompt itself.
const dockPromptBtn = page.getByTestId('canvas-prompt-dock');
await dockPromptBtn.waitFor({ timeout: 10000 });
await dockPromptBtn.click({ force: true });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, '04-composer-docked.png') });

// Verify the composer is actually visible (not just present in the DOM) and not
// geometrically covered by the Brain dock panel.
const composer = page.getByLabel('Ask Brain about this canvas');
const composerVisible = await composer.isVisible();
const composerBox = await composer.boundingBox();
const dock = page.locator('[aria-label="Brain chat"]');
const dockBox = await dock.boundingBox();

const overlapsVertically = composerBox && dockBox
  ? !(composerBox.y >= dockBox.y + dockBox.height || composerBox.y + composerBox.height <= dockBox.y)
  : null;
const overlapsHorizontally = composerBox && dockBox
  ? !(composerBox.x >= dockBox.x + dockBox.width || composerBox.x + composerBox.width <= dockBox.x)
  : null;

console.log(JSON.stringify({
  composerVisible,
  composerBox,
  dockBox,
  spatialOverlap: overlapsVertically && overlapsHorizontally,
  consoleErrors: errors.slice(0, 10),
}, null, 2));

await browser.close();
