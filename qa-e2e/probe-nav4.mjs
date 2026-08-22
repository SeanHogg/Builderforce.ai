import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => console.log('C', m.type(), m.text().slice(0, 500)));
page.on('pageerror', e => console.log('PAGEERROR', String(e.stack||e).slice(0,600)));
await page.addInitScript(() => {
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject() { return 1; },
    onCommitFiberRoot() { window.__commits++; },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    checkDCE() {}, on() {}, off() {}, sub() { return () => {}; }, emit() {},
    getFiberRoots() { return new Set(); }, reactDevtoolsAgent: null,
  };
  window.__pushes = [];
  const p = History.prototype.pushState;
  History.prototype.pushState = function (...a) { window.__pushes.push(a[2]); return p.apply(this, a); };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
console.log('commits after load:', await page.evaluate(() => window.__commits));
await page.evaluate(() => { window.__c0 = window.__commits; document.querySelector('a[href="/pricing"]').click(); });
await page.waitForTimeout(1000);
console.log('commits +1s:', await page.evaluate(() => window.__commits - window.__c0));
await page.waitForTimeout(5000);
console.log('commits +6s:', await page.evaluate(() => window.__commits - window.__c0));
console.log('pushes:', await page.evaluate(() => window.__pushes), 'url', page.url());

// Does history + popstate re-render?
await page.evaluate(() => { window.__c1 = window.__commits; history.pushState({}, '', '/about'); dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(3000);
console.log('after manual popstate commits:', await page.evaluate(() => window.__commits - window.__c1), 'url', page.url(), 'h1:', await page.locator('h1').first().textContent().catch(()=>null));
await browser.close();
