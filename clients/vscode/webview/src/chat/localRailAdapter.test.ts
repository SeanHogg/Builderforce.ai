import { describe, expect, it, vi } from 'vitest';
import type { ChatRailRequest, RailSnapshot, RailTicket } from '../../../src/chatRail/railProtocol';
import { createLocalRailAdapter, createRailStore, isFrameFor, REFRESH_EVERY_MS, type RemoteChatTicketsAdapter } from './localRailAdapter';

const ticket = (ref: string, extra: Partial<RailTicket> = {}): RailTicket => ({
  clientId: `c-${ref}`, linkId: Number(ref), kind: 'task', ref, label: `T${ref}`, status: 'todo',
  progressPct: 0, done: 0, total: 0, exists: true, linkType: 'linked', syncStatus: 'synced', ...extra,
});
const snapshot = (chatId: number | string, tickets: RailTicket[] = [ticket('1')]): RailSnapshot => ({
  chatId, found: true, tickets, links: [], freshness: { source: 'server-observed' },
  runHistory: { linkedRunnableTickets: 0, runs: [], dispatchers: [], executors: [] },
  summary: { mode: 'hybrid', destination: { kind: 'unbound' }, queued: { items: 0, bytes: 0 }, conflicts: 0, deadLetters: 0 },
});

function harness(options: { connected?: boolean } = {}) {
  let clock = 1_000_000;
  const calls: ChatRailRequest[] = [];
  const store = createRailStore();
  const questionsFor = vi.fn(async () => []);
  const host = {
    call: vi.fn(async <T,>(body: ChatRailRequest): Promise<T> => {
      calls.push(body);
      if (body.action === 'refresh') return { outcome: { status: 'ok', written: 0, tombstoned: 0 }, rail: snapshot(body.chatId) } as T;
      return snapshot(body.chatId) as T;
    }),
    connected: () => options.connected ?? true,
    questionsFor,
    untitled: (kind: string, ref: string) => `${kind}#${ref}`,
    now: () => clock,
  };
  const adapter = createLocalRailAdapter({} as RemoteChatTicketsAdapter, host as never, store);
  return { adapter, store, calls, questionsFor, advance: (ms: number) => { clock += ms; } };
}

const refreshes = (calls: ChatRailRequest[]) => calls.filter((c) => c.action === 'refresh').length;

describe('local rail adapter', () => {
  it('throttles the background refresh to once per window per chat', async () => {
    const h = harness();
    await h.adapter.listTickets(7);
    await h.adapter.listTickets(7);
    expect(refreshes(h.calls)).toBe(1);
    await h.adapter.listTickets(8);
    expect(refreshes(h.calls)).toBe(2);
    h.advance(REFRESH_EVERY_MS);
    await h.adapter.listTickets(7);
    expect(refreshes(h.calls)).toBe(3);
  });

  it('never refreshes for a read a host push caused, nor while disconnected', async () => {
    const h = harness();
    h.store.push(snapshot(7));
    await h.adapter.listTickets(7);
    expect(refreshes(h.calls)).toBe(0);
    const offline = harness({ connected: false });
    await offline.adapter.listTickets(7);
    expect(refreshes(offline.calls)).toBe(0);
  });

  it('formats an untitled ticket at render time from its kind and ref', async () => {
    const h = harness();
    h.store.set(snapshot(7));
    const tickets = await createLocalRailAdapter({} as RemoteChatTicketsAdapter, {
      call: async <T,>() => snapshot(7, [ticket('9', { label: '', kind: 'spec' })]) as T,
      connected: () => false, questionsFor: async () => [], untitled: (kind, ref) => `${kind}#${ref}`,
    }, h.store).listTickets(7);
    expect(tickets[0]!.label).toBe('spec#9');
  });

  it('questions filter by the LOCAL links, and a local chat asks the platform nothing', async () => {
    const h = harness();
    h.store.set(snapshot(7, [ticket('4')]));
    await h.adapter.listQuestions(7);
    expect(h.questionsFor).toHaveBeenCalledWith([expect.objectContaining({ kind: 'task', ref: '4' })]);
    expect(await h.adapter.listQuestions('00000000-0000-4000-8000-0000000000c9')).toEqual([]);
    expect(h.questionsFor).toHaveBeenCalledTimes(1);
  });
});

describe('isFrameFor', () => {
  it('accepts a push for the chat on screen only', () => {
    expect(isFrameFor({ chatId: 7 }, 7)).toBe(true);
    expect(isFrameFor({ chatId: 8 }, 7)).toBe(false);
    expect(isFrameFor({ chatId: '7' }, 7)).toBe(false);
    expect(isFrameFor({ chatId: 7 }, null)).toBe(false);
  });
});
