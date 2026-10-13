import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReplayTicketEffectDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { ReplayEffectChip } from './ReplayEffectChip';

/** PRD 33 §5.3.4 — the one-line effect of a replay-moment ticket. */

const effect = (over: Partial<ReplayTicketEffectDto> = {}): ReplayTicketEffectDto => ({
  taskId: 7,
  status: 'measured',
  metric: 'frustrated',
  route: '/pricing',
  before: { releaseKey: 'rel-a', sessions: 400, rate: 0.1 },
  after: { releaseKey: 'rel-b', sessions: 250, rate: 0.02 },
  delta: -0.08,
  minVisits: 200,
  ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('ReplayEffectChip', () => {
  it('a drop in frustration reads as better', async () => {
    vi.spyOn(replayApi, 'ticketEffect').mockResolvedValue(effect());
    render(<ReplayEffectChip taskId={7} />);
    expect(await screen.findByTestId('replay-effect')).toHaveAttribute('data-effect', 'better');
    expect(replayApi.ticketEffect).toHaveBeenCalledWith(7);
  });

  it('a drop in conversions reads as worse', async () => {
    vi.spyOn(replayApi, 'ticketEffect').mockResolvedValue(effect({ metric: 'conversions' }));
    render(<ReplayEffectChip taskId={7} />);
    expect(await screen.findByTestId('replay-effect')).toHaveAttribute('data-effect', 'worse');
  });

  it('waits for enough visits on the newer release', async () => {
    vi.spyOn(replayApi, 'ticketEffect').mockResolvedValue(effect({ status: 'waiting', delta: null }));
    render(<ReplayEffectChip taskId={7} />);
    expect(await screen.findByTestId('replay-effect')).toHaveAttribute('data-effect', 'waiting');
  });

  it('renders nothing for a ticket not raised from a moment', async () => {
    const read = vi.spyOn(replayApi, 'ticketEffect').mockResolvedValue(null);
    const { container } = render(<ReplayEffectChip taskId={7} />);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
