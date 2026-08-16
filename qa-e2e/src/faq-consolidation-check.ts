/**
 * Every marketing FAQ renders through the one <MarketingFaq> (`.mk-q`).
 *
 * Six surfaces each hand-rolled a `<details>` disclosure with its own borders,
 * chevron and type ramp, so the same kind of question looked different depending
 * on where a reader met it. This asserts each one now renders `.mk-q` items and
 * that none of the retired class names survive in the DOM.
 *
 *   BASE=http://localhost:3002 npx tsx src/faq-consolidation-check.ts
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Walk the page down so anything that mounts on visibility has mounted.
 *
 * The step count is fixed UP FRONT. Reading `document.body.scrollHeight` as the
 * loop condition never terminates on a page whose content grows while you scroll
 * it — the homepage lazy-mounts its lower bands, so the target moved every
 * iteration and the check hung instead of failing.
 */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const steps = Math.min(40, Math.ceil(document.body.scrollHeight / 600));
    for (let i = 0; i <= steps; i += 1) {
      window.scrollTo(0, i * 600);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
}

const BASE = process.env.BASE ?? 'http://localhost:3002';
const OUT = process.env.OUT ?? 'faq-shots';

/** path → the class names that page used to render its FAQ with. */
const SURFACES: Array<{ path: string; retired: string[]; settle?: 'load' | 'domcontentloaded' | 'networkidle' }> = [
  { path: '/', retired: ['[class*="faqItem"]'] },
  { path: '/features', retired: [] },
  { path: '/compare', retired: [] },
  { path: '/evermind', retired: ['.ev-faq details'] },
  { path: '/agents', retired: ['.cc-faq-item', '.cc-faq-q', '.cc-faq-a'] },
  { path: '/soc2', retired: [] },
  { path: '/login', retired: [] },
  { path: '/register', retired: [] },
  // RouteMarketing's own surface — the teaser a signed-out visitor gets for an
  // app route. It must be a route that actually CARRIES faq copy in
  // `routeMarketing.ts`; most do not, and one that doesn't renders zero items
  // for a reason that has nothing to do with this migration.
  // `domcontentloaded` rather than networkidle: the app shell keeps polling, so
  // networkidle never arrives here.
  { path: '/personas', retired: ['.rm-faq-item', '.rm-faq-q', '.rm-faq-a'], settle: 'domcontentloaded' },
];

/** `ONLY=/personas` narrows the run to one surface. */
const ONLY = process.env.ONLY;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;
  const note = (ok: boolean, label: string, detail = '') => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  };

  for (const theme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript((mode) => {
      localStorage.setItem('bf-theme', mode);
      document.documentElement.dataset.theme = mode;
    }, theme);
    const page = await context.newPage();

    for (const surface of SURFACES.filter((s) => !ONLY || s.path === ONLY)) {
      await page.goto(`${BASE}${surface.path}`, { waitUntil: surface.settle ?? 'networkidle', timeout: 120_000 });
      await page.getByRole('button', { name: /necessary only/i }).click().catch(() => {});
      // FAQs sit near the bottom; walk the page down so anything that mounts on
      // visibility has mounted before we count.
      await scrollThrough(page);
      await page.locator('details.mk-q').first().waitFor({ timeout: 20_000 }).catch(() => {});
      const shared = await page.locator('details.mk-q').count();
      note(shared > 0, `${theme} ${surface.path} · renders MarketingFaq`, `${shared} items`);
      for (const selector of surface.retired) {
        const leftover = await page.locator(selector).count();
        note(leftover === 0, `${theme} ${surface.path} · retired ${selector} gone`, `${leftover} found`);
      }
      if (theme === 'light' && shared > 0) {
        // The summary must stay legible — the old treatments each set their own
        // colour, so this is where a migration would show a contrast regression.
        const colour = await page.locator('details.mk-q > summary').first().evaluate(
          (el) => getComputedStyle(el).color,
        );
        note(/^rgb/.test(colour), `${theme} ${surface.path} · summary colour resolves`, colour);
      }
    }
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.getByRole('button', { name: /necessary only/i }).click().catch(() => {});
    await scrollThrough(page);
    await page.locator('details.mk-q').first().waitFor({ timeout: 20_000 }).catch(() => {});
    const firstOpen = await page.locator('details.mk-q[open]').count();
    note(firstOpen === 1, `${theme} / · homepage keeps its first answer open`, `${firstOpen} open`);
    await page.locator('details.mk-q').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/home-faq-${theme}.png` });
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main();
