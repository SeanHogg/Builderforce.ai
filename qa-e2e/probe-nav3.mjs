import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => console.log('C', m.type(), m.text().slice(0, 800)));
page.on('pageerror', e => console.log('PAGEERROR', String(e.stack||e).slice(0,800)));
await page.addInitScript(() => {
  const pd = Event.prototype.preventDefault;
  Event.prototype.preventDefault = function () {
    if (this.type === 'click') console.log('PREVENTDEFAULT click by:\n' + new Error().stack);
    return pd.call(this);
  };
  window.__navs = [];
  const origPush = History.prototype.pushState;
  History.prototype.pushState = function (...a) { window.__navs.push(['push', a[2]]); return origPush.apply(this, a); };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const state = await page.evaluate(() => ({
  hasNextData: !!window.__next_f,
  reactRoot: !!document.querySelector('body')?._reactRootContainer || !!Object.keys(document.querySelector('#__next') || {}).length,
  swCount: navigator.serviceWorker ? 'api' : 'none',
  html: document.documentElement.getAttribute('data-theme'),
  bodyKeys: Object.keys(document.body).filter(k => k.startsWith('__react')).slice(0,3),
}));
console.log('STATE', JSON.stringify(state));
const reqs = [];
page.on('request', r => reqs.push(r.method() + ' ' + r.url().slice(0,140)));
await page.evaluate(() => { document.querySelector('a[href="/pricing"]').click(); });
await page.waitForTimeout(4000);
console.log('URL', page.url());
console.log('NAVS', JSON.stringify(await page.evaluate(() => window.__navs)));
console.log('REQS during click:\n' + reqs.join('\n'));
await browser.close();
