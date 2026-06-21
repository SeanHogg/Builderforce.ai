import { describe, it, expect } from 'vitest';
import { validateSpec, fallbackSpec } from './QaGeneratorService';

const GOOD_SPEC = `import { test, expect } from '@playwright/test';

test('dashboard renders', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).not.toHaveURL(/\\/login/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
`;

describe('validateSpec — model-authored spec gating [#153]', () => {
  it('accepts a clean playwright-only spec', () => {
    expect(validateSpec(GOOD_SPEC)).toEqual({ ok: true });
  });

  it('rejects empty / non-playwright content', () => {
    expect(validateSpec('').ok).toBe(false);
    expect(validateSpec('console.log(1)').ok).toBe(false);
  });

  it('rejects a disallowed import', () => {
    const spec = `import { test } from '@playwright/test';\nimport fs from 'fs';\ntest('x', async () => {});`;
    const r = validateSpec(spec);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/fs/);
  });

  it('rejects every known escape hatch', () => {
    const vectors: Array<[string, RegExp]> = [
      [`import { test } from '@playwright/test';\nrequire('child_process');`, /require/],
      [`import { test } from '@playwright/test';\nawait import('node:fs');`, /import|node/],
      [`import { test } from '@playwright/test';\neval('1+1');`, /eval/],
      [`import { test } from '@playwright/test';\nnew Function('return 1')();`, /Function/],
      [`import { test } from '@playwright/test';\nprocess.env.SECRET;`, /process/],
      [`import { test } from '@playwright/test';\nfetch('https://evil.example');`, /network/],
      [`import { test } from '@playwright/test';\nawait page.evaluate(() => 1);`, /evaluate/],
      [`import { test } from '@playwright/test';\nawait page.request.get('/x');`, /page\.request/],
      [`import { test } from '@playwright/test';\nawait context.addInitScript(() => {});`, /addInitScript/],
    ];
    for (const [spec, reasonRe] of vectors) {
      const r = validateSpec(spec);
      expect(r.ok, `expected reject: ${spec.split('\\n')[1]}`).toBe(false);
      expect(r.reason).toMatch(reasonRe);
    }
  });

  it('rejects an implausibly large spec', () => {
    const huge = `import { test } from '@playwright/test';\n` + 'await page.goto("/x");\n'.repeat(2000);
    expect(validateSpec(huge).ok).toBe(false);
  });
});

describe('fallbackSpec — deterministic safe template', () => {
  it('always passes validateSpec', () => {
    const spec = fallbackSpec({
      name: "Admin's flow",
      slug: 'admin-flow',
      startRoute: '/admin',
      steps: [
        { action: 'goto', route: '/admin' },
        { action: 'click', selector: '#save' },
      ],
    });
    expect(validateSpec(spec)).toEqual({ ok: true });
    expect(spec).toContain("@playwright/test");
  });
});
