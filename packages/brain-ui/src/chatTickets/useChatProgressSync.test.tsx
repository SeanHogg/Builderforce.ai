// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ChatTicketHealthInput } from '@builderforce/agent-loop';
import { useChatProgressSync } from './useChatProgressSync';
import type { ChatOptionVM } from './types';

/**
 * ONE CHAT, ONE PERCENT.
 *
 * The rail read 60%, the picker 18% and the Sessions tree 23% for the same chat,
 * because only the rail refetched when a ticket moved. The rail now tells the host
 * when the picker's snapshot disagrees with the tickets it just read, and the host's
 * refetch carries one figure everywhere. These pin when it asks, and that it asks once.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIVE: ChatTicketHealthInput[] = [
  { progressPct: 100, done: 1, total: 1 },
  { progressPct: 50, done: 0, total: 1, status: 'in_progress' },
];

function Harness({ list, onStale, reads }: { list: ChatOptionVM[]; onStale: () => void; reads: ChatTicketHealthInput[][] }) {
  const sync = useChatProgressSync(7, list, onStale);
  useEffect(() => { for (const tickets of reads) sync(tickets); }, [sync, reads]);
  return null;
}

function run(list: ChatOptionVM[], reads: ChatTicketHealthInput[][]) {
  const onStale = vi.fn();
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(<Harness list={list} onStale={onStale} reads={reads} />); });
  act(() => { root.unmount(); });
  return onStale;
}

describe('useChatProgressSync', () => {
  it('asks the host to refetch when the picker snapshot is behind the tickets', () => {
    expect(run([{ id: 7, title: 'implement', ticketCount: 2, ticketProgressPct: 18 }], [LIVE])).toHaveBeenCalledTimes(1);
  });

  it('asks once for the same tickets, so a lagging server cannot start a loop', () => {
    expect(run([{ id: 7, title: 'implement', ticketCount: 2, ticketProgressPct: 18 }], [LIVE, LIVE, LIVE])).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the snapshot already agrees', () => {
    expect(run([{ id: 7, title: 'implement', ticketCount: 2, ticketProgressPct: 75 }], [LIVE])).not.toHaveBeenCalled();
  });

  it('stays quiet for a host whose list carries no ticket summary', () => {
    expect(run([{ id: 7, title: 'implement' }], [LIVE])).not.toHaveBeenCalled();
  });
});
