import { chromium } from '@playwright/test';

const OUT = 'C:/Users/seanh/AppData/Local/Temp/claude/c--code-agentic/89999910-24fd-4e60-b304-212590457014/scratchpad';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
await page.goto('https://builderforce.ai/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const trigger = page.locator('.mh-trigger', { hasText: /Product/i }).first();
await trigger.hover();
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.mh-item.has-menu')];
  return items.map(it => {
    const panel = it.querySelector('.mh-panel');
    const cs = panel ? getComputedStyle(panel) : null;
    const r = panel?.getBoundingClientRect();
    return {
      label: it.querySelector('button')?.textContent?.trim(),
      open: it.hasAttribute('data-open'),
      vis: cs?.visibility, op: cs?.opacity, pe: cs?.pointerEvents, z: cs?.zIndex,
      rect: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
});
console.log(JSON.stringify(info, null, 2));

// Which element is actually at the first mega link's centre?
const hit = await page.evaluate(() => {
  const links = [...document.querySelectorAll('.mh-mega-link')];
  const visible = links.filter(l => l.getBoundingClientRect().width > 0 && getComputedStyle(l.closest('.mh-panel')).visibility === 'visible');
  const l = visible[0];
  if (!l) return { error: 'no visible mega link', total: links.length };
  const r = l.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const top = document.elementFromPoint(cx, cy);
  const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map(e => `${e.tagName}.${(e.className && typeof e.className === 'string' ? e.className : '').split(' ').join('.')}`);
  return {
    href: l.getAttribute('href'),
    rect: { x: Math.round(cx), y: Math.round(cy) },
    topEl: top ? `${top.tagName}.${(typeof top.className === 'string' ? top.className : '')}` : null,
    containedByLink: l.contains(top),
    stack,
  };
});
console.log('HIT', JSON.stringify(hit, null, 2));

await page.screenshot({ path: `${OUT}/nav-open.png` });

// Now actually click it
const before = page.url();
const link = page.locator('.mh-panel .mh-mega-link').first();
try {
  await link.click({ timeout: 5000 });
} catch (e) { console.log('CLICK ERROR', String(e).slice(0, 400)); }
await page.waitForTimeout(2500);
console.log('URL before', before, '-> after', page.url());
await page.screenshot({ path: `${OUT}/nav-after-click.png` });
await browser.close();
