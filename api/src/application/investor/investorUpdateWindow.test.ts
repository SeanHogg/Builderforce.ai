/**
 * The send records WHERE its milestone window ended, and the next window starts there:
 * `payload.milestonesUntil` on every row, read back (preferred over sent_at / created_at)
 * by `lastInvestorUpdateWindowEnd`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../delivery/boardMilestones', () => ({ listBoardMilestonesSince: vi.fn(async () => []) }));
const transport = vi.hoisted(() => ({ send: vi.fn(async () => undefined) }));
vi.mock('../marketing/campaignTransports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../marketing/campaignTransports')>()),
  resolveCampaignSender: vi.fn(async () => ({ ok: true, sender: { send: transport.send, transport: 'platform', fromLabel: 'Acme' } })),
}));

import { lastInvestorUpdateWindowEnd } from './investorMilestones';
import { sendInvestorUpdate } from './investorUpdateDelivery';

/** Queued select results, plus a recorder for inserts and for the select projection. */
function stubDb(...results: unknown[][]) {
  const queue = [...results];
  const inserted: Array<Record<string, unknown>> = [];
  const projections: unknown[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = (projection: unknown) => { projections.push(projection); return chain; };
  for (const method of ['from', 'orderBy', 'limit', 'where']) chain[method] = () => chain;
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(queue.shift() ?? []);
  chain.insert = () => ({ values: async (row: Record<string, unknown>) => { inserted.push(row); } });
  return { db: chain as never, inserted, projections };
}

/** Flatten a drizzle `sql` fragment's literal text so the coalesce order can be asserted. */
function sqlText(node: unknown, depth = 0): string {
  if (!node || typeof node !== 'object' || depth > 10) return '';
  const record = node as { queryChunks?: unknown[]; value?: unknown; name?: string };
  if (Array.isArray(record.queryChunks)) return record.queryChunks.map((c) => sqlText(c, depth + 1)).join('');
  if (Array.isArray(record.value)) return record.value.join('');
  if (typeof record.name === 'string') return `[${record.name}]`;
  return '';
}

describe('lastInvestorUpdateWindowEnd', () => {
  it('returns the newest window end, or null when nothing was ever sent', async () => {
    const at = new Date('2026-10-15T00:00:00.000Z');
    expect(await lastInvestorUpdateWindowEnd(stubDb([{ at }]).db, 1)).toBe(at);
    expect(await lastInvestorUpdateWindowEnd(stubDb([{ at: null }]).db, 1)).toBeNull();
    expect(await lastInvestorUpdateWindowEnd(stubDb([]).db, 1)).toBeNull();
  });

  it('prefers milestonesUntil and falls back to sent_at, then created_at', async () => {
    const { db, projections } = stubDb([{ at: null }]);
    await lastInvestorUpdateWindowEnd(db, 1);
    const text = sqlText((projections[0] as { at: unknown }).at);
    expect(text).toContain("milestonesUntil");
    expect(text.indexOf('milestonesUntil')).toBeLessThan(text.indexOf('[sent_at]'));
    expect(text.indexOf('[sent_at]')).toBeLessThan(text.indexOf('[created_at]'));
  });
});

describe('sendInvestorUpdate', () => {
  it('writes the window end captured at the start of the send on every row of the batch', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-11-08T12:00:00.000Z');
      vi.setSystemTime(start);
      transport.send.mockImplementation(async () => { vi.setSystemTime(new Date(start.getTime() + 60_000)); });
      const { db, inserted } = stubDb([{ at: null }], []);
      await sendInvestorUpdate(db, {} as never, 9, {
        content: { title: 'October' },
        recipients: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
        binding: { transport: 'platform' } as never,
      });
      expect(inserted).toHaveLength(2);
      for (const row of inserted) {
        expect(row.template).toBe('investor_update');
        expect(row.payload).toEqual({ milestonesUntil: start.toISOString() });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
