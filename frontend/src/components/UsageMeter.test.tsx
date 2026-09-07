import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeterSnapshot } from '@/lib/builderforceApi';

/**
 * The expanded usage panel must survive a meter it has never heard of.
 *
 * The API and this app deploy separately, so the server routinely emits a meter
 * key this build predates — that is exactly how `stage_sandbox_runs` reached
 * `<Link href={undefined}>` and took the whole sidebar panel down with a
 * "Cannot destructure property 'auth'" from Next's own `formatUrl`. A meter is
 * looked up by key in one place now, and a miss has to degrade rather than throw.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: (key: string) => !key.endsWith('.unknown_future_meter') }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => {
    // Next's real Link throws on an undefined href; this is the assertion that
    // matters, so it has to fail the same way rather than quietly render.
    if (typeof href !== 'string') throw new TypeError("Cannot destructure property 'auth' of 'e' as it is undefined.");
    return <a href={href}>{children}</a>;
  },
}));

const consumption = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock('@/lib/useConsumption', () => ({ useConsumption: () => consumption.snapshot }));

import UsageMeter, { ConsumptionMeterCard } from './UsageMeter';

function meter(overrides: Partial<MeterSnapshot> = {}): MeterSnapshot {
  return {
    key: 'ai_tokens',
    unit: 'tokens',
    used: 1_300,
    limit: 50_000,
    unlimited: false,
    remaining: 48_700,
    percentUsed: 3,
    trend: [1, 2, 3],
    ...overrides,
  } as MeterSnapshot;
}

describe('ConsumptionMeterCard', () => {
  it('deep-links a known meter to its config and insight routes', () => {
    const { container } = render(<ConsumptionMeterCard meter={meter()} isFree />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/settings/integrations');
    expect(hrefs).toContain('/insights/ai');
  });

  it('renders the meter the API added after this build shipped', () => {
    const { container } = render(
      <ConsumptionMeterCard meter={meter({ key: 'stage_sandbox_runs', unit: 'sandbox_runs' })} isFree />,
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/marketplace');
  });

  it('degrades to a plain card for an unknown meter instead of crashing', () => {
    const unknown = meter({ key: 'unknown_future_meter' as MeterSnapshot['key'] });
    expect(() => render(<ConsumptionMeterCard meter={unknown} isFree />)).not.toThrow();

    const { container } = render(<ConsumptionMeterCard meter={unknown} isFree />);
    // No href is invented for a resource with no known entry point — but the
    // number, the bar and the always-valid "see plans" link still render.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/pricing']);
    expect(container.textContent).toContain('unknown_future_meter');
  });
});

/**
 * Usage sits below the destinations in the left menu, so expanding it by default
 * pushed navigation off-screen on short viewports. The section now starts folded
 * and only a member's own expand — the stored '0' — reopens it.
 */
describe('UsageMeter section default', () => {
  beforeEach(() => {
    window.localStorage.clear();
    consumption.snapshot = { plan: { effective: 'free' }, meters: [meter()] };
  });

  it('starts collapsed with no stored preference', () => {
    const { container } = render(<UsageMeter />);
    expect(container.querySelector('.usage-meter-head')?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('reopens for a member who expanded it before', () => {
    window.localStorage.setItem('bf.usageMeter.collapsed', '0');
    const { container } = render(<UsageMeter />);
    expect(container.querySelector('.usage-meter-head')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelectorAll('a').length).toBeGreaterThan(0);
  });
});
