/**
 * An associate's figures are keyed by ATTRIBUTION, not by workspace (operator decision
 * 2026-09-12).
 *
 * The double below answers each `sales_referrals` read by compiling the REAL `where`
 * clause with Drizzle's Postgres dialect and applying the predicates it finds to the
 * fixture rows. So these tests prove the statement the code builds, not a filter the test
 * re-implements: a scope that dropped the associate predicate would return another
 * associate's rows here exactly as it would in Postgres, and an unrecognised predicate
 * fails loudly instead of being ignored.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Env } from '../../env';
import {
  ledgerEntries, salesAssociateSettings, salesContacts, salesReferrals, users,
} from '../../infrastructure/database/schema';
import { buildSalesReport, earnedCommissionCents, recentReferrals } from './salesReports';
import { invalidateSalesReferrals, readReferralRecords } from './salesReferralFacts';
import { PayoutAccountService } from '../payouts/PayoutAccountService';
import { invalidatePersonPayouts } from '../payouts/personPayoutsCache';
import { userAccount } from '../kernel/ledgerAccount';

const dialect = new PgDialect();

interface ReferralRow {
  id: string;
  associateUserId: string;
  tenantId: number | null;
  attributionType: string;
  signedUpAt: Date;
  signupNotifiedAt: Date | null;
  convertedAt: Date | null;
  plan: string | null;
  revenueCents: number | null;
  commissionCents: number | null;
}

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = new Date('2026-09-12T12:00:00Z');

/** a1 referred into TWO workspaces (1 and 2) and has one signup not yet in any
 *  workspace; a2 is a different associate sharing workspace 1. */
const ROWS: ReferralRow[] = [
  { id: 'r1', associateUserId: 'a1', tenantId: 1, attributionType: 'referral', signedUpAt: at('2026-09-01'), signupNotifiedAt: at('2026-09-01'), convertedAt: at('2026-09-05'), plan: 'pro', revenueCents: 50_000, commissionCents: 10_000 },
  { id: 'r2', associateUserId: 'a1', tenantId: 2, attributionType: 'sales', signedUpAt: at('2026-09-03'), signupNotifiedAt: at('2026-09-03'), convertedAt: at('2026-09-10'), plan: 'teams', revenueCents: 80_000, commissionCents: 20_000 },
  { id: 'r3', associateUserId: 'a1', tenantId: null, attributionType: 'referral', signedUpAt: at('2026-09-08'), signupNotifiedAt: at('2026-09-08'), convertedAt: null, plan: null, revenueCents: null, commissionCents: null },
  { id: 'r4', associateUserId: 'a2', tenantId: 1, attributionType: 'referral', signedUpAt: at('2026-09-02'), signupNotifiedAt: at('2026-09-02'), convertedAt: at('2026-09-06'), plan: 'teams', revenueCents: 999_000, commissionCents: 99_900 },
  { id: 'r5', associateUserId: 'a2', tenantId: null, attributionType: 'referral', signedUpAt: at('2026-09-09'), signupNotifiedAt: null, convertedAt: null, plan: null, revenueCents: null, commissionCents: null },
];

const PEOPLE = [
  { id: 'a1', name: 'Ada', email: 'ada@example.com' },
  { id: 'a2', name: 'Bo', email: 'bo@example.com' },
];

/** Every `"table"."column"` a compiled clause references — the unrecognised-predicate check. */
const columnRefs = (sqlText: string) => [...sqlText.matchAll(/"(\w+)"\."(\w+)"/g)].map((m) => `${m[1]}.${m[2]}`);

/** Apply the predicates of a compiled `sales_referrals` where clause to the fixtures. */
function filterReferrals(rows: readonly ReferralRow[], where: unknown): { rows: ReferralRow[]; sql: string; params: unknown[] } {
  const { sql: text, params } = dialect.sqlToQuery(where as Parameters<PgDialect['sqlToQuery']>[0]);
  if (/\bor\b/i.test(text)) throw new Error(`the double only evaluates AND-ed predicates: ${text}`);
  const known = new Set(['sales_referrals.associate_user_id', 'sales_referrals.tenant_id', 'sales_referrals.signup_notified_at']);
  const unknown = columnRefs(text).filter((ref) => !known.has(ref));
  if (unknown.length > 0) throw new Error(`unrecognised predicate on ${unknown.join(', ')}: ${text}`);

  const param = (match: RegExpMatchArray) => params[Number(match[1]) - 1];
  let result = [...rows];
  for (const match of text.matchAll(/"sales_referrals"\."associate_user_id" = \$(\d+)/g)) {
    const value = param(match);
    result = result.filter((row) => row.associateUserId === value);
  }
  for (const match of text.matchAll(/"sales_referrals"\."tenant_id" = \$(\d+)/g)) {
    const value = param(match);
    result = result.filter((row) => row.tenantId === value);
  }
  if (/"sales_referrals"\."signup_notified_at" is not null/.test(text)) {
    result = result.filter((row) => row.signupNotifiedAt != null);
  }
  return { rows: result, sql: text, params };
}

/** A table-aware double for the sales report's four concurrent reads. */
function salesDb(rows: readonly ReferralRow[] = ROWS) {
  const referralReads: Array<{ sql: string; params: unknown[] }> = [];
  const answer = (table: unknown, where: unknown): unknown[] => {
    if (table === salesReferrals) {
      const read = filterReferrals(rows, where);
      referralReads.push({ sql: read.sql, params: read.params });
      return read.rows;
    }
    if (table === users) return PEOPLE;
    if (table === salesAssociateSettings) return [];
    if (table === salesContacts) return [];
    throw new Error('unexpected table');
  };
  const db = {
    select: () => ({
      from: (table: unknown) => {
        let where: unknown;
        const chain = {
          where: (clause: unknown) => { where = clause; return chain; },
          orderBy: () => chain,
          limit: () => chain,
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve().then(() => answer(table, where)).then(resolve, reject),
        };
        return chain;
      },
    }),
  };
  return { db: db as never, referralReads };
}

const allTime = (report: Awaited<ReturnType<typeof buildSalesReport>>) =>
  report.windows.find((row) => row.window === 'all')!;

describe('an associate sees every referral attributed to them', () => {
  it('spans both workspaces they referred into, plus a signup not yet in any workspace', async () => {
    const { db } = salesDb();
    const report = await buildSalesReport(db, null, { associateUserId: 'a1', now: NOW });

    expect(report.associateUserId).toBe('a1');
    expect(allTime(report)).toMatchObject({ signups: 3, conversions: 2, revenueCents: 130_000, commissionCents: 30_000 });
    expect(report.associates).toEqual([]);

    expect(await earnedCommissionCents(db, undefined, null, 'a1')).toBe(30_000);
    const leads = await recentReferrals(db, undefined, null, 'a1', new Date(0));
    expect(leads.map((lead) => lead.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('names no workspace and no referred person in what it returns', async () => {
    const { db } = salesDb();
    const lead = (await recentReferrals(db, undefined, null, 'a1', new Date(0)))[0]!;
    expect(Object.keys(lead).sort()).toEqual(
      ['attributionType', 'commissionCents', 'convertedAt', 'id', 'plan', 'revenueCents', 'signedUpAt'],
    );
  });
});

describe('an associate never sees another associate’s rows', () => {
  it('filters by the associate’s own attribution, not by any workspace', async () => {
    const { db, referralReads } = salesDb();
    await buildSalesReport(db, null, { associateUserId: 'a1', now: NOW });

    const read = referralReads[0]!;
    expect(read.sql).toContain('"sales_referrals"."associate_user_id" = $1');
    expect(read.sql).not.toContain('tenant_id');
    expect(read.params).toEqual(['a1']);
  });

  it('keeps a2’s commission out of a1’s figures, and a1’s out of a2’s — even in a shared workspace', async () => {
    const { db } = salesDb();
    const a1 = await buildSalesReport(db, null, { associateUserId: 'a1', now: NOW });
    const a2 = await buildSalesReport(db, null, { associateUserId: 'a2', now: NOW });

    expect(allTime(a1).commissionCents).toBe(30_000);
    expect(allTime(a2)).toMatchObject({ signups: 1, conversions: 1, commissionCents: 99_900 });

    expect(await earnedCommissionCents(db, undefined, null, 'a2')).toBe(99_900);
    const a1Leads = await recentReferrals(db, undefined, null, 'a1', new Date(0));
    const a2Leads = await recentReferrals(db, undefined, null, 'a2', new Date(0));
    expect(a1Leads.map((lead) => lead.id)).not.toContain('r4');
    expect(a2Leads.map((lead) => lead.id)).toEqual(['r5', 'r4']);
  });
});

describe('the superadmin aggregate', () => {
  it('spans every associate in every workspace, verified signups only', async () => {
    const { db, referralReads } = salesDb();
    const report = await buildSalesReport(db, null, { now: NOW });

    expect(report.associateUserId).toBeNull();
    // r1 (ws 1), r2 (ws 2), r3 (no ws yet), r4 (ws 1); r5 never verified.
    expect(allTime(report)).toMatchObject({ signups: 4, conversions: 3, commissionCents: 129_900 });
    expect(report.associates.map((line) => [line.associateUserId, line.commissionCents])).toEqual([
      ['a2', 99_900],
      ['a1', 30_000],
    ]);
    expect(referralReads[0]!.sql).not.toContain('tenant_id');
  });
});

describe('the workspace-scoped view is unchanged', () => {
  it('reads one workspace, for one associate or for all of them', async () => {
    const { db, referralReads } = salesDb();

    const mine = await buildSalesReport(db, 1, { associateUserId: 'a1', now: NOW });
    expect(allTime(mine)).toMatchObject({ signups: 1, conversions: 1, commissionCents: 10_000 });
    expect(referralReads[0]!.sql).toContain('"sales_referrals"."tenant_id" = $1');

    const everyone = await buildSalesReport(db, 1, { now: NOW });
    expect(allTime(everyone)).toMatchObject({ signups: 2, commissionCents: 109_900 });
    expect(everyone.associates.map((line) => line.associateUserId)).toEqual(['a2', 'a1']);

    expect(await earnedCommissionCents(db, undefined, 1, 'a1')).toBe(10_000);
    expect((await recentReferrals(db, undefined, 2, 'a1', new Date(0))).map((lead) => lead.id)).toEqual(['r2']);
  });
});

describe('the associate read is cached per associate', () => {
  const env = {} as Env;
  const scope = (associateUserId: string | null) => ({ tenantId: null, associateUserId });

  it('serves the second read from cache, with real dates, until a referral write for THAT associate', async () => {
    const { db, referralReads } = salesDb();
    const first = await readReferralRecords(db, env, scope('a1'));
    const second = await readReferralRecords(db, env, scope('a1'));
    expect(referralReads).toHaveLength(1);
    expect(second[0]!.signedUpAt).toBeInstanceOf(Date);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));

    // Another associate's write does not throw a1's figures away…
    await invalidateSalesReferrals(env, 'a2');
    await readReferralRecords(db, env, scope('a1'));
    expect(referralReads).toHaveLength(1);

    // …a1's does.
    await invalidateSalesReferrals(env, 'a1');
    await readReferralRecords(db, env, scope('a1'));
    expect(referralReads).toHaveLength(2);
  });

  it('drops the programme aggregate on ANY associate’s referral write', async () => {
    const { db, referralReads } = salesDb();
    await readReferralRecords(db, env, scope(null));
    await readReferralRecords(db, env, scope(null));
    expect(referralReads).toHaveLength(1);
    await invalidateSalesReferrals(env, 'a2');
    await readReferralRecords(db, env, scope(null));
    expect(referralReads).toHaveLength(2);
  });

  it('never caches the workspace-scoped view', async () => {
    const { db, referralReads } = salesDb();
    await readReferralRecords(db, env, { tenantId: 1, associateUserId: 'a1' });
    await readReferralRecords(db, env, { tenantId: 1, associateUserId: 'a1' });
    expect(referralReads).toHaveLength(2);
  });
});

describe('an associate’s payouts span every workspace, on their own account only', () => {
  /** Answers every ledger statement and keeps its compiled `where`. */
  function ledgerDb() {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      select: (fields?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          if (table !== ledgerEntries) throw new Error('unexpected table');
          const chain = {
            where: (clause: unknown) => {
              const { sql, params } = dialect.sqlToQuery(clause as Parameters<PgDialect['sqlToQuery']>[0]);
              statements.push({ sql, params });
              return chain;
            },
            orderBy: () => chain,
            limit: () => chain,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(fields && 'total' in fields ? [{ total: '2500' }] : []).then(resolve),
          };
          return chain;
        },
      }),
    };
    return { db: db as never, statements };
  }

  it('reads the associate’s own user account in every workspace, never a tenant', async () => {
    const { db, statements } = ledgerDb();
    const ledger = await new PayoutAccountService(db, {} as Env).personLedger('a1');

    expect(ledger).toEqual({ paidCents: 2_500, payouts: [] });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.sql).not.toContain('tenant_id');
      expect(statement.params).toEqual(expect.arrayContaining(['user', 'a1']));
    }
  });

  it('refuses a cross-workspace read of an account that is not a person', async () => {
    const { db } = ledgerDb();
    await expect(new PayoutAccountService(db, {} as Env).paidCents(null, { kind: 'tenant', ref: '7' } as never))
      .rejects.toThrow(/no cross-workspace payouts/);
  });

  it('caches the person ledger until a payout write for that person', async () => {
    const { db, statements } = ledgerDb();
    const env = {} as Env;
    const service = new PayoutAccountService(db, env);
    await service.personLedger('a1');
    await service.personLedger('a1');
    expect(statements).toHaveLength(2);

    await invalidatePersonPayouts(env, 'a1');
    await service.personLedger('a1');
    expect(statements).toHaveLength(4);
  });

  it('keeps the workspace-scoped payout read on its tenant', async () => {
    const { db, statements } = ledgerDb();
    await new PayoutAccountService(db, {} as Env).paidCents(7, userAccount('a1'));
    expect(statements[0]!.sql).toContain('"ledger_entries"."tenant_id" = $1');
  });
});
