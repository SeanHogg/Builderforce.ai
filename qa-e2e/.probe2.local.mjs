import { chromium } from '@playwright/test';
const OUT = process.env.SHOT_DIR;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:360,height:720}, deviceScaleFactor:2, hasTouch:true, isMobile:true });
const page = await ctx.newPage();
await page.addInitScript(() => { try { localStorage.setItem('bf-theme','light'); } catch {} });
await page.goto('http://localhost:3001/create/local-rail-probe-0007', { waitUntil:'domcontentloaded', timeout:90000 });
await page.waitForSelector('[data-testid="canvas-session-title"]', { timeout:90000 });
const tour = page.getByRole('dialog', { name:'Guided tour' });
if (await tour.count()) await tour.getByRole('button').first().click().catch(()=>{});
for (const n of ['Necessary only','Allow analytics']) { const b=page.getByRole('button',{name:n}); if (await b.count()){ await b.first().click().catch(()=>{}); break; } }
await page.waitForTimeout(2500);
const read = () => page.evaluate(() => {
  const flow = document.querySelector('[data-view]');
  const rail = document.querySelector('[aria-label="Canvas view controls"]')?.parentElement;
  const dock = document.querySelector('[class*="brainDock"]');
  const r = rail?.getBoundingClientRect(); const d = dock?.getBoundingClientRect();
  const cs = rail && getComputedStyle(rail);
  return {
    brainOpen: flow?.getAttribute('data-brain-open'),
    brainSide: flow?.getAttribute('data-brain-side'),
    rail: r && {y:Math.round(r.y), h:Math.round(r.height), w:Math.round(r.width), dir:cs.flexDirection, scrollH: rail.scrollHeight},
    dock: d && {y:Math.round(d.y), h:Math.round(d.height)},
    composerSpace: getComputedStyle(document.querySelector('[data-view]')).getPropertyValue('--composer-space'),
  };
});
console.log('ON LOAD:', JSON.stringify(await read()));
await page.screenshot({ path:`${OUT}/rail-onload.png` });
// Now close the Brain sheet and look again.
const x = page.locator('[class*="brainDockActions"] button').last();
if (await x.count()) { await x.click().catch(()=>{}); await page.waitForTimeout(1200); }
console.log('BRAIN CLOSED:', JSON.stringify(await read()));
await page.screenshot({ path:`${OUT}/rail-brainclosed.png` });
await browser.close();
