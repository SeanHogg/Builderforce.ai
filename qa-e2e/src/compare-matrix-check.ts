/**
 * Visual + structural check for the /compare comparison matrix.
 *
 * Asserts the matrix and FAQ actually render (they were dead catalog data
 * before), then captures both themes at desktop and 360px so the table's
 * horizontal scroll and the sticky feature column can be eyeballed.
 *
 * Run against a local dev server:  BASE=http://localhost:3001 npx tsx src/compare-matrix-check.ts
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:3001';
const OUT = process.env.OUT ?? 'compare-shots';

async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;
  const note = (ok: boolean, label: string, detail = '') => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  };

  for (const theme of ['light', 'dark'] as const) {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 360, 780]] as const) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      // The app themes off `html[data-theme]` + the `bf-theme` key, NOT
      // prefers-color-scheme — passing `colorScheme` alone silently tests dark
      // twice, which is exactly how a light-mode contrast bug ships.
      await page.addInitScript((mode) => {
        localStorage.setItem('bf-theme', mode);
        document.documentElement.dataset.theme = mode;
      }, theme);
      const consoleErrors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

      await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.waitForSelector('.cm-table', { timeout: 60_000 });
      // The consent banner is fixed to the bottom and would sit over the table
      // in every screenshot.
      await page.getByRole('button', { name: /necessary only/i }).click().catch(() => {});

      const tables = await page.locator('.cm-table').count();
      const rows = await page.locator('.cm-feature-name').count();
      const faq = await page.locator('details.mk-q').count();
      const vendorHeaders = await page.locator('.cm-table').first().locator('thead th').count();
      const pageOverflow = await overflows(page);
      // The matrix is allowed to scroll sideways — inside its own wrap only.
      const wrapScrolls = await page.evaluate(() => {
        const wrap = document.querySelector('.cm-table')?.closest('.table-wrap') as HTMLElement | null;
        return wrap ? wrap.scrollWidth > wrap.clientWidth : false;
      });
      // Sticky feature column must have an opaque background in BOTH themes.
      const featureBg = await page.evaluate(() => {
        const cell = document.querySelector('.cm-table tbody .cm-feature') as HTMLElement | null;
        return cell ? getComputedStyle(cell).backgroundColor : '';
      });
      const opaque = /^rgb\(/.test(featureBg);
      const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');

      const tag = `${theme}-${name}`;
      note(appliedTheme === theme, `${tag} · theme actually applied`, `html[data-theme]=${appliedTheme}`);
      note(tables === 8, `${tag} · 8 category tables`, `got ${tables}`);
      note(rows === 40, `${tag} · 40 feature rows`, `got ${rows}`);
      note(faq === 6, `${tag} · 6 FAQ entries`, `got ${faq}`);
      note(vendorHeaders === 9, `${tag} · 9 columns (capability + us + 7)`, `got ${vendorHeaders}`);
      note(!pageOverflow, `${tag} · no page-level horizontal overflow`);
      note(opaque, `${tag} · sticky column opaque`, featureBg);
      note(consoleErrors.length === 0, `${tag} · no console errors`, consoleErrors[0] ?? '');
      if (name === 'mobile') note(wrapScrolls, `${tag} · matrix scrolls inside its wrap`);

      await page.locator('#cm-heading').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/compare-${tag}.png` });
      await context.close();
    }
  }

  // The leaf variant: two columns, not eight.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(`${BASE}/compare/cursor`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('.cm-table', { timeout: 60_000 });
  await page.getByRole('button', { name: /necessary only/i }).click().catch(() => {});
  const leafCols = await page.locator('.cm-table').first().locator('thead th').count();
  const verdict = await page.locator('.vs-verdict').count();
  note(leafCols === 3, 'leaf · 3 columns (capability + us + vendor)', `got ${leafCols}`);
  note(verdict === 1, 'leaf · verdict block renders', `got ${verdict}`);
  await page.locator('#cm-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/compare-leaf-cursor.png` });

  // The footer's Product column is where a visitor is meant to find this page.
  const columns = await page.locator('.global-footer-col').evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector('h3')?.textContent?.trim() ?? '',
      links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
    })),
  );
  const product = columns.find((c) => /product/i.test(c.title));
  const learn = columns.find((c) => /learn|resource/i.test(c.title));
  note(!!product?.links.includes('/compare'), 'footer · /compare under Product', product?.links.join(' ') ?? 'no Product column');
  note(!learn?.links.includes('/compare'), 'footer · /compare no longer duplicated under Learn');
  await page.locator('.global-footer-cols').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/footer.png` });
  await context.close();

  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main();
