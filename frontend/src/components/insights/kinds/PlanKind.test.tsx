import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

/** PRD 33 D4 — the `plan` panel kind: usage, packs, receipts. */

const usage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/replaySitesApi', () => ({ replaySitesApi: { usage } }));

const capabilityApi = vi.hoisted(() => ({ packs: vi.fn(), startPackCheckout: vi.fn() }));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/capabilityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/capabilityApi')>()),
  capabilityApi,
  invalidateCapabilityState: invalidate,
}));

// The manager gate is RoleGate's own concern (tested there); these tests run as a manager.
vi.mock('@/components/RoleGate', () => ({ RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { PlanKind, RECEIPTS_HREF } = await import('./PlanKind');

beforeEach(() => {
  usage.mockReset().mockResolvedValue({ period: '2026-10', freeAllowance: 5_000, freeUsed: 4_200, credits: 10_000, used: 4_200, limit: 15_000 });
  capabilityApi.packs.mockReset().mockResolvedValue([
    { id: 'pack-10k', units: 10_000, amountCents: 4_000 },
    { id: 'pack-50k', units: 50_000, amountCents: 14_000 },
  ]);
  capabilityApi.startPackCheckout.mockReset();
  invalidate.mockReset();
  window.history.replaceState(null, '', '/apps/insights?panel=plan:usage');
});

describe('PlanKind', () => {
  it('shows the month against the free allowance and the credits', async () => {
    render(<PlanKind siteId="site-1" id="usage" push={vi.fn()} />);
    expect(await screen.findByTestId('plan-usage')).toHaveTextContent('4,200');
    expect(screen.getByTestId('plan-usage')).toHaveTextContent('15,000');
    expect(screen.getByTestId('plan-credits')).toHaveTextContent('10,000');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '4200');
    expect(screen.getByText(/insights\.plan\.freeUsed 4,200 5,000/)).toBeInTheDocument();
  });

  it('offers every pack as a button that starts its checkout', async () => {
    capabilityApi.startPackCheckout.mockRejectedValue(new Error('payments off'));
    render(<PlanKind siteId="site-1" id="packs" push={vi.fn()} />);
    const buttons = await screen.findAllByRole('button', { name: /buyAria/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);
    await vi.waitFor(() => expect(capabilityApi.startPackCheckout).toHaveBeenCalledWith(
      'pack-50k',
      expect.stringContaining('/apps/insights?panel=plan:packs&checkout={CHECKOUT_SESSION_ID}'),
    ));
    // A refused checkout is said, and the buttons come back.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(buttons[0]).not.toBeDisabled();
  });

  it('links to the workspace’s receipts', async () => {
    render(<PlanKind siteId="site-1" id="usage" push={vi.fn()} />);
    expect(await screen.findByRole('link', { name: 'insights.plan.receipts' })).toHaveAttribute('href', RECEIPTS_HREF);
  });

  it('back from the processor: reads fresh numbers and says the credit is on its way', async () => {
    window.history.replaceState(null, '', '/apps/insights?panel=plan:packs&checkout=session-123');
    render(<PlanKind siteId="site-1" id="packs" push={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent('insights.plan.checkoutReturned');
    expect(invalidate).toHaveBeenCalled();
  });
});
