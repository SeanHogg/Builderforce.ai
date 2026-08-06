import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'https://builderforce.ai/create/local-probe-1111-2222-3333-444455556666';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const report = await page.evaluate(() => {
  const describe = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      class: element.className,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
      transform: style.transform,
    };
  };
  const controls = document.querySelector('.react-flow__controls');
  const flow = document.querySelector('.react-flow');
  const wrap = document.querySelector('[data-view]');
  const rect = controls?.getBoundingClientRect();
  const topmost = rect && rect.width
    ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    : null;
  return {
    view: wrap?.getAttribute('data-view') ?? null,
    reserved: {
      left: wrap ? getComputedStyle(wrap).getPropertyValue('--canvas-reserved-left') : null,
      right: wrap ? getComputedStyle(wrap).getPropertyValue('--canvas-reserved-right') : null,
    },
    flow: describe(flow),
    controls: describe(controls),
    controlButtons: [...document.querySelectorAll('.react-flow__controls button')].map((button) => button.getAttribute('aria-label')),
    topmostAtControls: topmost ? `${topmost.tagName}.${topmost.className}` : null,
    scene: describe(document.querySelector('[data-testid="canvas-3d-view"]')),
  };
});

console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: process.argv[3] ?? 'rail-probe.png' });
await browser.close();
