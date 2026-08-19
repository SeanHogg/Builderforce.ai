/**
 * WHAT THE WRITER MUST GET RIGHT THAT THE MACHINE CANNOT.
 *
 * `escrow.test.ts` pins every decision. What is left for this file is the part a pure
 * function cannot express, and it is the part that loses money:
 *
 *   • A refusal writes NOTHING — not a ledger row, not a status.
 *   • Money is written BEFORE status, so a half-failure leaves a reconcilable hold
 *     rather than a milestone that claims funds nobody captured.
 *   • The status write carries the expected status, so two concurrent approvals
 *     produce one winner without a transaction (neon-http has none).
 *   • A release still happens when no payout provider is configured — the ledger entry
 *     is the platform's own record, and refusing would strand every self-hosted install.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

const notify = vi.fn(async (..._args: unknown[]) => ({ inAppDelivered: true, emailDelivered: null }));
vi.mock('../notifications/notify', () => ({ notify: (...args: unknown[]) => notify(...args) }));

const createPayout = vi.fn(async (..._args: unknown[]) => ({ configured: true, ok: true, externalRef: 'px_1' }));
const isPayoutsConfigured = vi.fn(() => true);
vi.mock('../integrations/payments', () => ({
  createPayout: (...args: unknown[]) => createPayout(...args),
  isPayoutsConfigured: (...args: unknown[]) => isPayoutsConfigured(...args),
}));

const { moveMilestone, deleteDraftMilestone } = await import('./milestones');

const env = {} as unknown as Env;

const milestone = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm-1',
  tenantId: 7,
  jobId: null,
  engagementId: 'e-1',
  freelancerUserId: 'user-f',
  title: 'Design system',
  description: null,
  sequence: 0,
  amountCents: 250_000,
  currency: 'USD',
  status: 'draft',
  dueAt: null,
  fundedAt: null,
  submittedAt: null,
  approvedAt: null,
  releasedAt: null,
  submissionNote: null,
  rejectionReason: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  ...over,
});

/**
 * The literal values bound into a Drizzle condition.
 *
 * A `SQL` object references its own table, so it is circular and cannot be stringified.
 * Walking it with a seen-set is what lets a test assert that a guard actually carries
 * the value it claims to, rather than only that a `where` was passed at all — which is
 * the assertion that would still pass if the guard were dropped.
 */
function boundValues(node: unknown, seen = new Set<unknown>()): unknown[] {
  if (node == null || typeof node !== 'object') return node == null ? [] : [node];
  if (seen.has(node)) return [];
  seen.add(node);
  // A Drizzle `Param` holds its bound literal on `value`; everything else is structure.
  const record = node as Record<string, unknown>;
  if ('value' in record && typeof record.value !== 'object') return [record.value];
  const children = Array.isArray(node) ? node : Object.values(record);
  return children.flatMap((child) => boundValues(child, seen));
}

const move = (action: string, party: 'client' | 'freelancer', db: ReturnType<typeof fakeDb>) =>
  moveMilestone(env, db as unknown as Db, {
    tenantId: 7, milestoneId: 'm-1', action: action as never, party, actorUserId: 'user-c',
  });

beforeEach(() => {
  notify.mockClear();
  createPayout.mockClear();
  createPayout.mockResolvedValue({ configured: true, ok: true, externalRef: 'px_1' });
  isPayoutsConfigured.mockReturnValue(true);
});

describe('moveMilestone — refusals write nothing', () => {
  it('404s an unknown milestone without writing', async () => {
    const db = fakeDb([[]]);

    expect(await move('fund', 'client', db)).toEqual({ ok: false, reason: 'not_found' });
    expect(db.calls.filter((call) => call.kind !== 'select')).toHaveLength(0);
  });

  it('refuses the wrong party and writes no ledger row and no status', async () => {
    const db = fakeDb([[milestone({ status: 'submitted' })]]);

    expect(await move('approve', 'freelancer', db)).toEqual({ ok: false, reason: 'wrong_party' });
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(0);
    expect(db.calls.filter((call) => call.kind === 'update')).toHaveLength(0);
  });

  it('refuses the wrong state and writes nothing', async () => {
    const db = fakeDb([[milestone({ status: 'draft' })]]);

    expect(await move('release', 'client', db)).toEqual({ ok: false, reason: 'wrong_status' });
    expect(db.calls.filter((call) => call.kind !== 'select')).toHaveLength(0);
  });

  it('refuses to fund a zero-value milestone', async () => {
    const db = fakeDb([[milestone({ amountCents: 0 })]]);

    expect(await move('fund', 'client', db)).toEqual({ ok: false, reason: 'no_amount' });
    expect(db.calls.filter((call) => call.kind !== 'select')).toHaveLength(0);
  });
});

describe('moveMilestone — funding', () => {
  it('writes the HOLD before the status, and debits the client tenant', async () => {
    const db = fakeDb([[milestone()], [], [milestone({ status: 'funded' })]]);

    const result = await move('fund', 'client', db);

    expect(result).toMatchObject({ ok: true, movedMoney: true });
    const kinds = db.calls.map((call) => call.kind);
    // read → ledger insert → status update. The order is the whole point.
    expect(kinds).toEqual(['select', 'insert', 'update']);
    expect(db.calls[1]?.payload).toMatchObject({
      tenantId: 7,
      accountKind: 'tenant',
      accountRef: '7',
      denomination: 'usd_cents',
      // Negative: the client's money leaves their available balance.
      amount: '-250000',
      entryKind: 'hold',
      reference: 'escrow:m-1:fund',
    });
  });

  it('absorbs a replayed fund on the unique reference rather than double-holding', async () => {
    const db = fakeDb([[milestone()], [], [milestone({ status: 'funded' })]]);

    await move('fund', 'client', db);

    // The idempotency is the DB's: the insert declares the conflict clause rather than
    // the service pre-checking for an existing entry.
    expect(db.calls[1]?.chain).toContain('onConflictDoNothing');
  });

  it('stamps funded_at alongside the status', async () => {
    const db = fakeDb([[milestone()], [], [milestone({ status: 'funded' })]]);

    await move('fund', 'client', db);

    const update = db.calls.find((call) => call.kind === 'update');
    expect(update?.payload).toMatchObject({ status: 'funded' });
    expect((update?.payload as Record<string, unknown>).fundedAt).toBeInstanceOf(Date);
  });
});

describe('moveMilestone — release', () => {
  it('credits the FREELANCER\'s user account and calls the payout provider', async () => {
    const db = fakeDb([[milestone({ status: 'approved' })], [], [milestone({ status: 'released' })]]);

    const result = await move('release', 'client', db);

    expect(result).toMatchObject({ ok: true, movedMoney: true, payoutConfigured: true });
    expect(db.calls[1]?.payload).toMatchObject({
      accountKind: 'user',
      accountRef: 'user-f',
      amount: '250000',
      entryKind: 'payout',
      reference: 'escrow:m-1:release',
    });
    expect(createPayout).toHaveBeenCalledWith(env, expect.objectContaining({
      amountCents: 250_000, freelancerUserId: 'user-f', tenantId: 7,
    }));
  });

  it('still releases when no payout provider is configured, and says so', async () => {
    // A self-hosted deployment with no PAYOUT_WEBHOOK_URL must still be able to close
    // out a milestone — the ledger entry is the platform's own record.
    isPayoutsConfigured.mockReturnValue(false);
    createPayout.mockResolvedValue({ configured: false, ok: false });
    const db = fakeDb([[milestone({ status: 'approved' })], [], [milestone({ status: 'released' })]]);

    const result = await move('release', 'client', db);

    expect(result).toMatchObject({ ok: true, movedMoney: true, payoutConfigured: false });
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(1);
  });

  it('does not reuse the funding reference, so a release is never read as a replay', async () => {
    const funded = fakeDb([[milestone()], [], [milestone({ status: 'funded' })]]);
    await move('fund', 'client', funded);
    const released = fakeDb([[milestone({ status: 'approved' })], [], [milestone({ status: 'released' })]]);
    await move('release', 'client', released);

    expect((funded.calls[1]?.payload as Record<string, unknown>).reference)
      .not.toBe((released.calls[1]?.payload as Record<string, unknown>).reference);
  });
});

describe('moveMilestone — the moves that touch no money', () => {
  it('submit records the note and writes no ledger row', async () => {
    const db = fakeDb([[milestone({ status: 'funded' })], [milestone({ status: 'submitted' })]]);

    const result = await moveMilestone(env, db as unknown as Db, {
      tenantId: 7, milestoneId: 'm-1', action: 'submit', party: 'freelancer',
      actorUserId: 'user-f', note: 'Deployed to staging',
    });

    expect(result).toMatchObject({ ok: true, movedMoney: false });
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(0);
    expect(db.calls.find((call) => call.kind === 'update')?.payload)
      .toMatchObject({ status: 'submitted', submissionNote: 'Deployed to staging' });
  });

  it('reject records the reason and leaves the money held', async () => {
    const db = fakeDb([[milestone({ status: 'submitted' })], [milestone({ status: 'disputed' })]]);

    const result = await moveMilestone(env, db as unknown as Db, {
      tenantId: 7, milestoneId: 'm-1', action: 'reject', party: 'client',
      actorUserId: 'user-c', note: 'Missing the mobile breakpoints',
    });

    expect(result).toMatchObject({ ok: true, movedMoney: false });
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(0);
    expect(db.calls.find((call) => call.kind === 'update')?.payload)
      .toMatchObject({ status: 'disputed', rejectionReason: 'Missing the mobile breakpoints' });
  });
});

describe('moveMilestone — cancellation', () => {
  it('refunds a funded milestone to the client tenant', async () => {
    const db = fakeDb([[milestone({ status: 'funded' })], [], [milestone({ status: 'cancelled' })]]);

    const result = await move('cancel', 'client', db);

    expect(result).toMatchObject({ ok: true, movedMoney: true });
    expect(db.calls[1]?.payload).toMatchObject({
      accountKind: 'tenant', amount: '250000', entryKind: 'refund', reference: 'escrow:m-1:cancel',
    });
  });

  it('writes NO ledger row when cancelling an unfunded draft', async () => {
    const db = fakeDb([[milestone({ status: 'draft' })], [milestone({ status: 'cancelled' })]]);

    const result = await move('cancel', 'client', db);

    expect(result).toMatchObject({ ok: true, movedMoney: false });
    expect(db.calls.filter((call) => call.kind === 'insert')).toHaveLength(0);
  });
});

describe('moveMilestone — concurrency', () => {
  it('guards the status write with the status it decided against', async () => {
    const db = fakeDb([[milestone({ status: 'submitted' })], [milestone({ status: 'approved' })]]);

    await move('approve', 'client', db);

    // The WHERE carries the expected status; a second concurrent approval updates zero
    // rows and loses, with no transaction involved.
    const update = db.calls.find((call) => call.kind === 'update');
    expect(update?.where).toBeDefined();
    expect(boundValues(update?.where)).toContain('submitted');
  });

  it('reports a lost race as a conflict rather than as success', async () => {
    // The guarded update returns no rows: somebody else moved it first.
    const db = fakeDb([[milestone({ status: 'submitted' })], []]);

    expect(await move('approve', 'client', db)).toEqual({ ok: false, reason: 'conflict' });
  });
});

describe('deleteDraftMilestone', () => {
  it('deletes and reports true', async () => {
    const db = fakeDb([[{ id: 'm-1' }]]);
    expect(await deleteDraftMilestone(db as unknown as Db, 7, 'm-1')).toBe(true);
  });

  it('reports false when the row was past draft — a financial record is not editable', async () => {
    const db = fakeDb([[]]);
    expect(await deleteDraftMilestone(db as unknown as Db, 7, 'm-1')).toBe(false);
  });
});
