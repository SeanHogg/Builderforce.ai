import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FinanceLens embeds the installed vertical dashboard. FinanceDashboardView ->
 * WidgetCard -> useComponentDrill -> FinancePanelProvider -> financePanels ->
 * FinanceLens is an import cycle, so the view must stay a lazy `dynamic()` import:
 * a static import would load the cycle eagerly and leave a binding undefined.
 */
describe('FinanceLens import cycle guard', () => {
  const source = readFileSync(join(__dirname, 'FinanceLens.tsx'), 'utf8');

  it('loads FinanceDashboardView lazily, not with a static import', () => {
    expect(source).not.toMatch(/^import\s+\{[^}]*FinanceDashboardView[^}]*\}\s+from/m);
    expect(source).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/finance\/FinanceDashboardView'\)/);
  });

  it('renders the preset dashboard under the localised card title', () => {
    expect(source).toContain("t('fin.verticalDashboard')");
    expect(source).toContain('<FinanceDashboardView />');
  });
});
