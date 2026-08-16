import { chromium } from '@playwright/test';

const OUT = process.env.SHOT_DIR;
const URL = 'http://localhost:3001/create/local-visual-check-0001';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 780 },
  { name: 'phone-narrow', width: 360, height: 720 },
];

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: scheme,
      deviceScaleFactor: 2,
      hasTouch: vp.name !== 'desktop',
      isMobile: vp.name !== 'desktop',
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('[data-testid="canvas-session-title"]', { timeout: 90_000 });
    // The guided-tour offer is a modal veil over the whole board on a first visit;
    // dismiss it so the chrome under it can be seen.
    const tour = page.getByRole('dialog', { name: 'Guided tour' });
    if (await tour.count()) {
      await tour.getByRole('button').first().click().catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${scheme}-${vp.name}.png` });

    // The ••• sheet is the phone's only route to five session actions — shoot it open.
    const more = page.getByRole('button', { name: 'More session actions' });
    if (await more.count()) {
      await more.first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-${vp.name}-more.png` });
      await more.first().click();
      await page.waitForTimeout(300);
    }
    // And the invite sheet, which a phone could not reach at all before.
    const share = page.getByRole('button', { name: 'Share', exact: true });
    if (vp.name === 'desktop' && await share.count()) {
      await share.first().click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-${vp.name}-share.png` });
    }
    await ctx.close();
    console.log('shot', scheme, vp.name);
  }
}
await browser.close();
