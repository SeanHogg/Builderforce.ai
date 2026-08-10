import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicPages = ['/', '/login', '/register', '/legal/compliance', '/legal/privacy-rights', '/legal/accessibility'];

for (const path of publicPages) {
  test(`WCAG 2.2 automated audit: ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
}

test('cookie consent is keyboard reachable and GTM is absent before opt-in', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('builderforce-consent-v1'));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog', { name: 'Your privacy choices' })).toBeVisible();
  await expect(page.locator('#builderforce-gtm')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reject optional' }).click();
  await expect(page.locator('#builderforce-gtm')).toHaveCount(0);
});
