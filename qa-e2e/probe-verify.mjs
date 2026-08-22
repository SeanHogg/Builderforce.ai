import { chromium } from '@playwright/test';
const url = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,200)));
await page.addInitScript(() => {
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(){return 1;}, onCommitFiberRoot(){ window.__commits++; }, onCommitFiberUnmount(){}, onPostCommitFiberRoot(){},
    checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();} };
});
await page.goto(url, { waitUntil: 'load', timeout: 2400000 });
await page.waitForTimeout(10000);
const a = await page.evaluate(() => window.__commits);
await page.waitForTimeout(4000);
const b = await page.evaluate(() => window.__commits);
console.log('total commits', b, '| idle rate/s', Math.round((b - a) / 4));

// Real navigation test: click a nav link and a footer link.
for (const href of ['/pricing', '/about']) {
  const before = page.url();
  const ok = await page.evaluate((h) => { const a = document.querySelector(`a[href="${h}"]`); if (!a) return false; a.click(); return true; }, href);
  if (!ok) { console.log(href, 'NO LINK FOUND'); continue; }
  await page.waitForURL(`**${href}`, { timeout: 240000 }).catch(() => {});
  console.log(`click ${href}:`, before, '->', page.url(), page.url().endsWith(href) ? 'NAVIGATED ✓' : 'DEAD ✗');
  await page.waitForTimeout(2000);
}
await browser.close();
