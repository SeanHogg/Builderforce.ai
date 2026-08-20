/**
 * The round HEADER — what a raise is trying to do, as a record rather than four
 * fields typed onto a card.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `finance.funding_rounds` had exactly two references in the whole codebase: the
 * Drizzle declaration and its entity registration. No writer, no reader, no route.
 * So the `fundingRound` canvas card carried `roundType`, `targetAmount`,
 * `valuation` and `closeTarget` as authored board JSON sitting beside an empty
 * table, and three of those four had no column to live in even if somebody had
 * wanted to write them.
 *
 * ── THE ONE DECISION THIS FILE ENCODES ───────────────────────────────────────
 * A round has a PLAN and a RESULT, and they are different kinds of fact.
 *
 * The plan is negotiated and typed: the instrument, what you are raising, the
 * valuation you are asking for, the date you intend to close. Nothing derives
 * those; they are decisions, and they live here.
 *
 * The result is arithmetic over the allocations — how much is committed, how much
 * has actually closed, how many firms are still in play. `funding_rounds` used to
 * carry `amount_raised` for that, and migration 0937 DROPPED it: a stored total
 * the `deals` rows can contradict is exactly what the "no stored totals" rule
 * (0464, `work_estimates.lines`) exists to prevent, and it is the same defect
 * `fundingRound.investors` had one layer up. {@link roundWithProgress} joins the
 * two at read time so a caller gets both and neither can drift.
 *
 * ── WHY THE ROUND IS KEYED BY NAME ───────────────────────────────────────────
 * `deals.pipeline_ref` is how an allocation says which round it belongs to, and
 * `funding_rounds.name` is unique per (tenant, company). Keying on the name is
 * what lets the raise projection and this record find each other without a third
 * id nobody would remember to set — the same join `pipeline_stages` already makes.
 */

import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { fundingRounds } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export class FundingRoundError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'FundingRoundError';
  }
}

/** The card's own vocabulary, and the column's. Declared once. */
export const ROUND_TYPES = ['pre-seed', 'seed', 'series-a', 'series-b', 'bridge', 'safe'] as const;
export type RoundType = typeof ROUND_TYPES[number];

/** What the money is: equity, or an instrument that becomes equity later. */
export const ROUND_INSTRUMENTS = ['equity', 'safe', 'convertible-note', 'grant', 'debt'] as const;

export const ROUND_STATUSES = ['open', 'closed', 'abandoned'] as const;

export interface FundingRoundRecord {
  id: number;
  name: string;
  roundType: string | null;
  instrument: string;
  targetAmount: number | null;
  preMoney: number | null;
  postMoney: number | null;
  currency: string;
  leadInvestor: string | null;
  closeTargetAt: string | null;
  closedAt: string | null;
  status: string;
}

const money = (value: string | null): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const COLUMNS = {
  id: fundingRounds.id,
  name: fundingRounds.name,
  roundType: fundingRounds.roundType,
  instrument: fundingRounds.instrument,
  targetAmount: fundingRounds.targetAmount,
  preMoney: fundingRounds.preMoney,
  postMoney: fundingRounds.postMoney,
  currency: fundingRounds.currency,
  leadInvestor: fundingRounds.leadInvestor,
  closeTargetAt: fundingRounds.closeTargetAt,
  closedAt: fundingRounds.closedAt,
  status: fundingRounds.status,
};

type Row = { [K in keyof typeof COLUMNS]: unknown };

const project = (row: Row): FundingRoundRecord => ({
  id: row.id as number,
  name: row.name as string,
  roundType: (row.roundType as string | null) ?? null,
  instrument: (row.instrument as string) ?? 'equity',
  targetAmount: money(row.targetAmount as string | null),
  preMoney: money(row.preMoney as string | null),
  postMoney: money(row.postMoney as string | null),
  currency: (row.currency as string) ?? 'USD',
  leadInvestor: (row.leadInvestor as string | null) ?? null,
  closeTargetAt: (row.closeTargetAt as Date | null)?.toISOString() ?? null,
  closedAt: (row.closedAt as Date | null)?.toISOString() ?? null,
  status: (row.status as string) ?? 'open',
});

/** Every round this workspace has planned, newest first. */
export async function listFundingRounds(db: Db, tenantId: number): Promise<FundingRoundRecord[]> {
  const rows = await db
    .select(COLUMNS)
    .from(fundingRounds)
    .where(scopedToTenant(fundingRounds, tenantId))
    .orderBy(desc(fundingRounds.updatedAt))
    .limit(50);
  return rows.map(project);
}

/** ONE round by the name its allocations use as `pipeline_ref`. Null when the
 *  founder has deals on a round they have not planned a header for, which is a
 *  normal and honest state — the board still draws. */
export async function fundingRoundByName(db: Db, tenantId: number, name: string): Promise<FundingRoundRecord | null> {
  const clean = name.trim();
  if (!clean) return null;
  const [row] = await db
    .select(COLUMNS)
    .from(fundingRounds)
    .where(scopedToTenant(fundingRounds, tenantId, eq(fundingRounds.name, clean)))
    .limit(1);
  return row ? project(row) : null;
}

export interface UpsertFundingRoundInput {
  name: string;
  roundType?: string | null;
  instrument?: string | null;
  targetAmount?: number | null;
  preMoney?: number | null;
  postMoney?: number | null;
  currency?: string | null;
  leadInvestor?: string | null;
  closeTargetAt?: string | null;
  status?: string | null;
  objectId?: string | null;
}

/**
 * Plan a round, or change the plan.
 *
 * Idempotent on the NAME, because the name is what the allocations join to: a
 * second call with the same name edits the round rather than creating a rival one
 * that half the deals point at. Only the fields a caller actually supplies move —
 * a surface that knows the close date and not the valuation must not blank the
 * valuation by omitting it.
 *
 * `closedAt` is derived from `status` rather than accepted separately, for the
 * same reason `deals.closedAt` is derived from the stage: a round marked closed
 * with no date, or dated closed while still open, is a record that disagrees with
 * itself.
 */
export async function upsertFundingRound(
  db: Db,
  tenantId: number,
  input: UpsertFundingRoundInput,
): Promise<FundingRoundRecord> {
  const name = input.name?.trim();
  if (!name) throw new FundingRoundError('Name the round — "Seed 2026". The name is what its investor allocations join to.', 400);
  if (name.length > 120) throw new FundingRoundError('That round name is too long (120 characters).', 400);

  const check = (value: string | null | undefined, allowed: readonly string[], label: string): string | undefined => {
    if (value == null) return undefined;
    const clean = value.trim();
    if (!clean) return undefined;
    if (!allowed.includes(clean)) throw new FundingRoundError(`"${clean}" is not a ${label}. Use one of: ${allowed.join(', ')}.`, 400);
    return clean;
  };

  const roundType = check(input.roundType, ROUND_TYPES, 'round type');
  const instrument = check(input.instrument, ROUND_INSTRUMENTS, 'instrument');
  const status = check(input.status, ROUND_STATUSES, 'status');
  const closeTargetAt = input.closeTargetAt ? new Date(input.closeTargetAt) : undefined;
  if (closeTargetAt && Number.isNaN(closeTargetAt.getTime())) throw new FundingRoundError('closeTargetAt is not a date.', 400);

  const amount = (value: number | null | undefined): string | null | undefined =>
    value === undefined ? undefined : value == null ? null : String(value);

  const now = new Date();
  const patch = {
    ...(roundType !== undefined ? { roundType } : {}),
    ...(instrument !== undefined ? { instrument } : {}),
    ...(amount(input.targetAmount) !== undefined ? { targetAmount: amount(input.targetAmount)! } : {}),
    ...(amount(input.preMoney) !== undefined ? { preMoney: amount(input.preMoney)! } : {}),
    ...(amount(input.postMoney) !== undefined ? { postMoney: amount(input.postMoney)! } : {}),
    ...(input.currency?.trim() ? { currency: input.currency.trim().slice(0, 8) } : {}),
    ...(input.leadInvestor !== undefined ? { leadInvestor: input.leadInvestor?.trim().slice(0, 200) || null } : {}),
    ...(closeTargetAt !== undefined ? { closeTargetAt } : {}),
    ...(status !== undefined ? { status, closedAt: status === 'closed' ? now : null } : {}),
    ...(input.objectId ? { objectId: input.objectId } : {}),
    updatedAt: now,
  };

  const existing = await fundingRoundByName(db, tenantId, name);
  if (existing) {
    await db.update(fundingRounds).set(patch).where(scopedToTenant(fundingRounds, tenantId, eq(fundingRounds.id, existing.id)));
  } else {
    await db.insert(fundingRounds).values({ tenantId, name, ...patch });
  }

  const saved = await fundingRoundByName(db, tenantId, name);
  if (!saved) throw new FundingRoundError('The round could not be saved.', 500);
  return saved;
}

/** Retire a round. The allocations stay — a round that was abandoned is a fact,
 *  and the conversations that happened on it are the record of why. */
export async function closeFundingRound(db: Db, tenantId: number, name: string, status: 'closed' | 'abandoned'): Promise<FundingRoundRecord> {
  return upsertFundingRound(db, tenantId, { name, status });
}
