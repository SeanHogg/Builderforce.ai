import { chromium } from '@playwright/test';

const url = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(9000);
// Dismiss any consent card so it cannot be the thing covering the rail.
for (const name of [/accept/i, /agree/i, /got it/i, /allow/i]) {
  const button = page.getByRole('button', { name }).first();
  if (await button.count() && await button.isVisible().catch(() => false)) { await button.click().catch(() => {}); break; }
}
await page.locator('.react-flow__controls button[aria-label="Toggle 3D view"]').click();
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const describe = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }, display: style.display, position: style.position, zIndex: style.zIndex, opacity: style.opacity, visibility: style.visibility };
  };
  const controls = document.querySelector('.react-flow__controls');
  const rect = controls.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 20);
  return {
    view: document.querySelector('[data-view]')?.getAttribute('data-view'),
    flow: describe(document.querySelector('.react-flow')),
    controls: describe(controls),
    buttons: [...controls.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    scene: describe(document.querySelector('[data-testid="canvas-3d-view"]')),
    topmostOverRail: hit ? `${hit.tagName}.${hit.className}` : null,
  };
});
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: process.argv[3] });
await browser.close();
