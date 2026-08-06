import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const out = await page.evaluate(() => {
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      const text = rule.cssText || '';
      if (/react-flow/.test(text) && /(z-index|position)/.test(text)) hits.push(text.slice(0, 260));
    }
  }
  const flow = document.querySelector('.react-flow');
  return { inlineZ: flow.style.zIndex, inlinePos: flow.style.position, hits: hits.slice(0, 40) };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
