import { chromium } from '@playwright/test';
const HOOK = () => {
  window.__commits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(){return 1;}, onCommitFiberRoot(){ window.__commits++; }, onCommitFiberUnmount(){}, onPostCommitFiberRoot(){},
    checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();} };
};
const urls = ['https://builderforce.ai/', 'https://builderforce.ai/pricing', 'https://builderforce.ai/blog', 'https://builderforce.ai/login', 'https://builderforce.ai/this-route-does-not-exist-xyz', 'https://builderforce.ai/about'];
const browser = await chromium.launch();
for (const u of urls) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(HOOK);
  try {
    await page.goto(u, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(4000);
    const a = await page.evaluate(() => window.__commits);
    await page.waitForTimeout(3000);
    const b = await page.evaluate(() => window.__commits);
    console.log(u.padEnd(52), 'total', String(a).padStart(7), ' rate/s', Math.round((b - a) / 3));
  } catch (e) { console.log(u, 'ERR', String(e).slice(0, 120)); }
  await page.close();
}
await browser.close();
