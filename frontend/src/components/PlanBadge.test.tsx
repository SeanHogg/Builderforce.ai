import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PlanBadge } from './PlanBadge';
import * as consumption from '@/lib/useConsumption';
import type { ConsumptionSnapshot, MeterSnapshot } from '@/lib/builderforceApi';

vi.mock('@/lib/useConsumption');

/**
 * The chip exists so a free member learns their tier and remaining allowance BEFORE
 * a turn dies on the cap. So the states that matter are: says nothing until it knows
 * (never a misleading "Free" while loading), shows the allowance only when one
 * actually bounds anything, and points at the page that changes the tier.
 *
 * Copy is the passthrough key under the global next-intl mock (see src/test/setup.ts).
 */
function tokenMeter(over: Partial<MeterSnapshot> = {}): MeterSnapshot {
  return {
    key: 'ai_tokens',
    unit: 'tokens',
    used: 1_000,
    limit: 250_000,
    unlimited: false,
    remaining: 249_000,
    percentUsed: 0,
    ...over,
  } as MeterSnapshot;
}

function snapshot(
  plan: ConsumptionSnapshot['plan']['effective'],
  meters: MeterSnapshot[] = [tokenMeter()],
): ConsumptionSnapshot {
  return {
    period: { start: '2026-07-01T00:00:00Z', resetsAt: '2026-08-01T00:00:00Z' },
    plan: { effective: plan, billingStatus: 'none' },
    meters,
  } as ConsumptionSnapshot;
}

const mockSnapshot = (s: ConsumptionSnapshot | null) =>
  vi.spyOn(consumption, 'useConsumption').mockReturnValue(s);

describe('PlanBadge', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('renders nothing until the plan is known', () => {
    // A "Free" flash at someone who is actually on Pro is worse than no chip.
    mockSnapshot(null);
    const { container } = render(<PlanBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows tier, remaining allowance and an upgrade CTA on the free plan', () => {
    mockSnapshot(snapshot('free'));
    const { getByRole, getByText } = render(<PlanBadge />);
    expect(getByText('planBadge.tier.free')).toBeTruthy();
    expect(getByText('planBadge.tokensLeft')).toBeTruthy();
    expect(getByText('planBadge.upgrade')).toBeTruthy();
    expect(getByRole('link').getAttribute('href')).toBe('/pricing?upgrade=pro');
  });

  it('drops the upgrade CTA and links to plan management on a paid plan', () => {
    mockSnapshot(snapshot('pro'));
    const { getByRole, getByText, queryByText } = render(<PlanBadge />);
    expect(getByText('planBadge.tier.pro')).toBeTruthy();
    expect(queryByText('planBadge.upgrade')).toBeNull();
    expect(getByRole('link').getAttribute('href')).toBe('/pricing');
  });

  it('says "no tokens left" once the allowance is spent', () => {
    mockSnapshot(snapshot('free', [tokenMeter({ used: 250_000, remaining: 0, percentUsed: 100 })]));
    const { getByText, queryByText } = render(<PlanBadge />);
    expect(getByText('planBadge.noTokens')).toBeTruthy();
    expect(queryByText('planBadge.tokensLeft')).toBeNull();
  });

  it('shows the tier alone when the allowance is unlimited', () => {
    // An unlimited meter reports remaining = -1; rendering that as a count would be
    // both wrong and alarming.
    mockSnapshot(snapshot('teams', [tokenMeter({ unlimited: true, limit: -1, remaining: -1 })]));
    const { getByText, queryByText } = render(<PlanBadge />);
    expect(getByText('planBadge.tier.teams')).toBeTruthy();
    expect(queryByText('planBadge.tokensLeft')).toBeNull();
    expect(queryByText('planBadge.noTokens')).toBeNull();
  });

  it('shows the tier alone when there is no token meter at all', () => {
    mockSnapshot(snapshot('free', []));
    const { getByText, queryByText } = render(<PlanBadge />);
    expect(getByText('planBadge.tier.free')).toBeTruthy();
    expect(queryByText('planBadge.tokensLeft')).toBeNull();
  });
});
