/**
 * `paidCents` — and the one thing it must not count.
 *
 * Two different acts write `entry_kind = 'payout'` on the same user account: this
 * service, when money LEAVES the platform to somebody's bank, and
 * `application/marketplace/milestones.ts`, when an escrow milestone is RELEASED —
 * which credits the freelancer's in-platform balance and moves nothing outward.
 *
 * Summing both made an escrow release look like a withdrawal, so `availableCents`
 * — the number a person is told they may withdraw — went DOWN by exactly the amount
 * they had just earned. That is the worst shape a money bug can take: it is silent,
 * it is in the customer's disfavour, and the ledger it is derived from is correct,
 * so nothing reconciles wrong.
 *
 * The two are separable because escrow stamps its own reference namespace
 * (`escrow:<milestoneId>:<action>`, from `escrowLedgerReference`), which nothing
 * else writes. These tests pin BOTH halves of that: the predicate is actually on
 * the statement, and the arithmetic downstream of it is right.
 */
import { describe, expect, it } from 'vitest';
import { escrowLedgerReference } from '../marketplace/escrow';
import { PayoutAccountService } from './PayoutAccountService';

/**
 * Capture the `where` clause of the single aggregate and answer with a total.
 *
 * Deliberately not `test/fakeDb`: what needs asserting here is the SQL PREDICATE,
 * not the call sequence, and `whereColumns` reports column names — which cannot
 * see a raw `sql\`… not like 'escrow:%'\`` fragment at all.
 */
function aggregateDb(total: number) {
  const captured: { sql: string[] } = { sql: [] };
  const collect = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      // A bound parameter stores its literal on `value`; a raw `sql` fragment stores
      // its text as a StringChunk whose `value` is an ARRAY of strings. Both matter:
      // the first proves the column filters, the second proves the reference filter.
      if (key === 'value' && typeof value === 'string') captured.sql.push(value);
      if (key === 'value' && Array.isArray(value)) {
        for (const part of value) if (typeof part === 'string') captured.sql.push(part);
      }
      if (Array.isArray(value)) value.forEach((v) => collect(v, depth + 1));
      else if (value && typeof value === 'object') collect(value, depth + 1);
    }
  };

  const db = {
    select: () => ({
      from: () => ({
        where: (clause: unknown) => {
          collect(clause);
          return Promise.resolve([{ total: String(total) }]);
        },
      }),
    }),
  };
  return { db, predicate: () => captured.sql.join(' ') };
}

/**
 * `paidCents` issues one statement and touches nothing else on the service, so the
 * `env` half of the constructor (the payout provider) is never reached — passing an
 * empty object states that rather than standing up a provider this test would not use.
 */
function paidCents(db: unknown): Promise<number> {
  return new PayoutAccountService(db as never, {} as never).paidCents(7, 'user-1');
}

describe('paidCents', () => {
  it('excludes escrow references from the withdrawal total', async () => {
    const { db, predicate } = aggregateDb(2_500);
    await paidCents(db);

    // The filter must be ON the statement, not applied afterwards in JS — the whole
    // point of one indexed SUM is that the database does the excluding.
    expect(predicate()).toContain("not like 'escrow:%'");
  });

  it('keeps a payout row that carries no reference at all', async () => {
    const { db, predicate } = aggregateDb(2_500);
    await paidCents(db);

    // A NULL reference is a real withdrawal from before references were stamped.
    // Dropping it would under-report what has already left and let it leave twice.
    expect(predicate()).toContain('is null');
  });

  it('returns the aggregate the database computed, rounded to whole cents', async () => {
    const { db } = aggregateDb(1_234.6);
    await expect(paidCents(db)).resolves.toBe(1_235);
  });

  it('reads zero when nothing has been withdrawn', async () => {
    const { db } = aggregateDb(0);
    await expect(paidCents(db)).resolves.toBe(0);
  });
});

describe('the reference namespace the filter depends on', () => {
  /**
   * If `escrowLedgerReference` ever stops producing an `escrow:`-prefixed string,
   * the filter above silently stops filtering and the bug returns — with no failing
   * test anywhere, because both modules would still be internally consistent. This
   * is the assertion that couples them.
   */
  it('is `escrow:` for every money-moving escrow action', () => {
    for (const action of ['release', 'cancel', 'fund', 'resolve'] as const) {
      expect(escrowLedgerReference('m-1', action)).toMatch(/^escrow:/);
    }
  });

  it('names the milestone and the action, so two moves on one milestone cannot collide', () => {
    expect(escrowLedgerReference('m-1', 'release')).not.toBe(escrowLedgerReference('m-1', 'cancel'));
    expect(escrowLedgerReference('m-1', 'release')).not.toBe(escrowLedgerReference('m-2', 'release'));
  });
});
