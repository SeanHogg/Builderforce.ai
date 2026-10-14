import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { replayApi } from '@/lib/replayApi';
import { prescription } from '@/test/replayPrescriptionFixtures';
import { InsightsScopeProvider } from '../insightsScope';
import { FIXES_PAGE_SIZE, FixesKind } from './FixesKind';

/**
 * The `fixes` kind: every fix for the filter, area chips that narrow it (only
 * areas that have fixes, with counts), a page at a time — each THE card, compact.
 */

function renderKind(id = '') {
  render(
    <InsightsScopeProvider siteId="site-1">
      <FixesKind siteId="site-1" id={id} push={vi.fn()} />
    </InsightsScopeProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/apps/insights');
  vi.spyOn(replayApi, 'listPrescriptions').mockResolvedValue([
    ...Array.from({ length: FIXES_PAGE_SIZE + 5 }, (_, i) => prescription({ id: `rx-ux-${i}`, rank: i + 1 })),
    prescription({ id: 'rx-sales', area: 'sales', ruleId: 'pricing_hesitation', rank: 99 }),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FixesKind', () => {
  it('pages through the list client-side', async () => {
    renderKind();
    expect(await screen.findAllByTestId('prescription-card')).toHaveLength(FIXES_PAGE_SIZE);
    fireEvent.click(screen.getByRole('button', { name: 'insights.fixes.loadMore' }));
    expect(screen.getAllByTestId('prescription-card')).toHaveLength(FIXES_PAGE_SIZE + 6);
    expect(screen.queryByRole('button', { name: 'insights.fixes.loadMore' })).toBeNull();
  });

  it('narrows by area chip, offering only areas that have fixes', async () => {
    renderKind();
    await screen.findAllByTestId('prescription-card');
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual([
      `insights.fixes.areaAll ${FIXES_PAGE_SIZE + 6}`,
      `insights.fixes.areaChip replay.prescription.area.ux ${FIXES_PAGE_SIZE + 5}`,
      'insights.fixes.areaChip replay.prescription.area.sales 1',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'insights.fixes.areaChip replay.prescription.area.sales 1' }));
    const cards = screen.getAllByTestId('prescription-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-rule', 'pricing_hesitation');
  });

  it('opens on the area its level id names', async () => {
    renderKind('sales');
    expect(await screen.findAllByTestId('prescription-card')).toHaveLength(1);
  });
});
