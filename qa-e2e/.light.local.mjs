import { chromium } from '@playwright/test';
const OUT = process.env.SHOT_DIR;
const browser = await chromium.launch();
for (const vp of [{n:'desktop',w:1440,h:900},{n:'phone',w:360,h:720}]) {
  const ctx = await browser.newContext({ viewport:{width:vp.w,height:vp.h}, deviceScaleFactor:2, hasTouch:vp.n!=='desktop', isMobile:vp.n!=='desktop' });
  const page = await ctx.newPage();
  // The app owns its theme (a class on <html>), not prefers-color-scheme — set it before
  // first paint so the canvas tokens resolve light from the start.
  await page.addInitScript(() => { try { localStorage.setItem('bf-theme','light'); } catch {} });
  await page.goto(`http://localhost:3001/create/local-light-${vp.n}-01`, { waitUntil:'domcontentloaded', timeout:90000 });
  await page.waitForSelector('[data-testid="canvas-session-title"]', { timeout:90000 });
  const tour = page.getByRole('dialog', { name:'Guided tour' });
  if (await tour.count()) await tour.getByRole('button').first().click().catch(()=>{});
  for (const name of ['Necessary only','Allow analytics']) {
    const b = page.getByRole('button',{name}); if (await b.count()) { await b.first().click().catch(()=>{}); break; }
  }
  await page.waitForTimeout(1200);
  console.log(vp.n, 'html class:', await page.evaluate(() => document.documentElement.className + ' | ' + document.documentElement.dataset.theme));
  await page.waitForTimeout(800);
  await page.screenshot({ path:`${OUT}/light2-${vp.n}.png` });
  if (vp.n === 'desktop') {
    await page.getByRole('button',{name:'Share',exact:true}).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path:`${OUT}/light2-desktop-share.png` });
  }
  await ctx.close();
}
await browser.close();
