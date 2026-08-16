import { chromium } from '@playwright/test';
const OUT = process.env.SHOT_DIR;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:360,height:720}, deviceScaleFactor:2, hasTouch:true, isMobile:true });
const page = await ctx.newPage();
await page.goto('http://localhost:3001/create/local-visual-check-0002', { waitUntil:'domcontentloaded', timeout:90000 });
await page.waitForSelector('[data-testid="canvas-session-title"]', { timeout:90000 });
const tour = page.getByRole('dialog', { name:'Guided tour' });
if (await tour.count()) { await tour.getByRole('button').first().click().catch(()=>{}); }
// Cookie banner covers the board's bottom-left, where the rail lives.
for (const name of ['Necessary only','Allow analytics']) {
  const b = page.getByRole('button', { name });
  if (await b.count()) { await b.first().click().catch(()=>{}); break; }
}
await page.waitForTimeout(1500);
// Close the Brain sheet so the rail is unobstructed.
const closeBrain = page.getByRole('button', { name:/Close|Hide/ });
if (await closeBrain.count()) await closeBrain.first().click().catch(()=>{});
await page.waitForTimeout(1200);

const info = await page.evaluate(() => {
  const flow = document.querySelector('[data-view]');
  const controls = document.querySelector('[aria-label="Canvas view controls"]');
  const rail = controls?.parentElement;
  const toggle = document.querySelector('[aria-label="Toggle object palette"]');
  const bar = document.querySelector('[data-testid="canvas-session-title"]')?.closest('div')?.parentElement;
  const r = rail?.getBoundingClientRect();
  const cs = rail ? getComputedStyle(rail) : null;
  return {
    brainOpen: flow?.getAttribute('data-brain-open'),
    view: flow?.getAttribute('data-view'),
    railRect: r && { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) },
    railPosition: cs?.position, railDirection: cs?.flexDirection, railMaxHeight: cs?.maxHeight,
    railChildren: rail ? [...rail.children].map((c) => c.getAttribute('aria-label') || c.tagName) : null,
    railButtons: rail ? [...rail.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : null,
    toggleIsInRail: !!(toggle && rail && rail.contains(toggle)),
    sessionBarButtons: bar ? [...bar.querySelectorAll('button')].filter((b)=>getComputedStyle(b).display!=='none').map((b)=>b.getAttribute('aria-label')||b.textContent.trim()) : null,
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: `${OUT}/probe-phone-clean.png` });

// Now the ••• sheet — the phone's only route to five actions.
await page.getByRole('button', { name:'More session actions' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/probe-phone-more.png` });
const sheet = await page.evaluate(() => [...document.querySelector('[data-testid="canvas-more-menu"]').querySelectorAll('button')].map((b)=>b.textContent.trim()));
console.log('SHEET:', JSON.stringify(sheet));
await browser.close();
