/**
 * Session-replay recording wallet — credits and the free monthly allowance
 * as two accounts on the same `ledger_entries` denomination.
 *
 * Paid packs credit `account_ref = tenantId` with metadata.expiresAt twelve
 * months out. The free allowance never writes a grant: spend against
 * `account_ref = free:yyyy-mm` is what the month has used, and remaining is
 * `freeMonthlyUnits - used`. That keeps the free pool from mixing with paid
 * credits (a SUM of the tenant account would otherwise look like leftover
 * free recordings a refund could claw back).
 *
 * `prepaidBalance()` cannot be used here: its denomination argument is the
 * kernel union, which does not yet include `replay_recordings`, and a SUM
 * cannot honour expiry. FIFO remaining is computed in process from the
 * statement, then cached.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  REPLAY_CREDIT_TTL_MONTHS,
  REPLAY_FREE_MONTHLY_UNITS,
  REPLAY_RECORDINGS_DENOMINATION,
  replayCreditExpiresAt,
  replayPeriod,
} from './replayCatalog';

export interface ReplayLedgerRow {
  amount: number;
  kind: string;
  reference: string | null;
  occurredAt: Date;
  accountRef: string;
  metadata: Record<string, unknown> | null;
}

export interface ReplayWalletSnapshot {
  credits: number;
  freeUsed: number;
  freeRemaining: number;
  period: string;
}

const creditsKey = (tenantId: number) => `replay:credits:t:${tenantId}`;
const freeKey = (tenantId: number, period: string) => `replay:free:t:${tenantId}:${period}`;

function asMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function tenantAccount(tenantId: number) {
  return scopedToTenant(
    ledgerEntries,
    tenantId,
    eq(ledgerEntries.accountKind, 'tenant'),
    eq(ledgerEntries.accountRef, String(tenantId)),
    eq(ledgerEntries.denomination, REPLAY_RECORDINGS_DENOMINATION),
  );
}

function freeAccount(tenantId: number, period: string) {
  return scopedToTenant(
    ledgerEntries,
    tenantId,
    eq(ledgerEntries.accountKind, 'tenant'),
    eq(ledgerEntries.accountRef, `free:${period}`),
    eq(ledgerEntries.denomination, REPLAY_RECORDINGS_DENOMINATION),
  );
}

/**
 * Remaining paid credits after FIFO consumption and expiry. Spends (and
 * refunds, which are negative) eat the oldest still-live grant first; a
 * grant whose `expiresAt` has passed contributes nothing even if it was
 * never fully spent.
 */
export function spendableCredits(rows: ReplayLedgerRow[], now: Date): number {
  const grants = rows
    .filter((row) => row.kind === 'grant' && row.amount > 0)
    .map((row) => {
      const raw = row.metadata?.expiresAt;
      const expiresAt = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : Number.POSITIVE_INFINITY;
      return {
        remaining: row.amount,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY,
        at: row.occurredAt.getTime(),
      };
    })
    .sort((a, b) => a.at - b.at);

  const spends = rows
    .filter((row) => row.amount < 0)
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const spend of spends) {
    let need = -spend.amount;
    for (const grant of grants) {
      if (need <= 0) break;
      const take = Math.min(grant.remaining, need);
      grant.remaining -= take;
      need -= take;
    }
  }

  const nowMs = now.getTime();
  let live = 0;
  for (const grant of grants) {
    if (grant.expiresAt > nowMs) live += grant.remaining;
  }
  return live;
}

/** Unused remainder of one grant (a pack refund claws this back, not the whole wallet). */
export function remainingOfGrant(rows: ReplayLedgerRow[], grantReference: string, now: Date): number {
  const grant = rows.find((row) => row.kind === 'grant' && row.reference === grantReference && row.amount > 0);
  if (!grant) return 0;
  const raw = grant.metadata?.expiresAt;
  const expiresAt = typeof raw === 'string' || typeof raw === 'number' ? Date.parse(String(raw)) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) return 0;

  // Conservative: consume every spend against every grant FIFO, then read this
  // grant's leftover. A refund never claws back units a later pack replaced.
  const grants = rows
    .filter((row) => row.kind === 'grant' && row.amount > 0)
    .map((row) => ({
      reference: row.reference,
      remaining: row.amount,
      at: row.occurredAt.getTime(),
    }))
    .sort((a, b) => a.at - b.at);

  const spends = rows
    .filter((row) => row.amount < 0)
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const spend of spends) {
    let need = -spend.amount;
    for (const g of grants) {
      if (need <= 0) break;
      const take = Math.min(g.remaining, need);
      g.remaining -= take;
      need -= take;
    }
  }

  return grants.find((g) => g.reference === grantReference)?.remaining ?? 0;
}

async function loadCreditRows(db: Db, tenantId: number): Promise<ReplayLedgerRow[]> {
  const rows = await db
    .select({
      amount: ledgerEntries.amount,
      kind: ledgerEntries.entryKind,
      reference: ledgerEntries.reference,
      occurredAt: ledgerEntries.occurredAt,
      accountRef: ledgerEntries.accountRef,
      metadata: ledgerEntries.metadata,
    })
    .from(ledgerEntries)
    .where(tenantAccount(tenantId));

  return rows.map((row) => ({
    amount: Math.round(Number(row.amount)),
    kind: row.kind,
    reference: row.reference,
    occurredAt: asDate(row.occurredAt),
    accountRef: row.accountRef,
    metadata: asMetadata(row.metadata),
  }));
}

async function move(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    amount: number;
    reference: string;
    memo: string;
    accountRef: string;
    entryKind: 'grant' | 'spend' | 'refund';
    metadata?: Record<string, unknown> | null;
  },
  sign: 1 | -1,
): Promise<boolean> {
  const amount = Math.ceil(input.amount);
  if (amount <= 0) return false;
  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'tenant',
    accountRef: input.accountRef,
    denomination: REPLAY_RECORDINGS_DENOMINATION,
    amount: String(sign * amount),
    entryKind: input.entryKind,
    reference: input.reference,
    memo: input.memo,
    metadata: input.metadata ?? null,
  }).onConflictDoNothing().returning({ id: ledgerEntries.id });

  if (inserted.length === 0) return false;
  await invalidateCached(env, creditsKey(input.tenantId));
  if (input.accountRef.startsWith('free:')) {
    await invalidateCached(env, freeKey(input.tenantId, input.accountRef.slice('free:'.length)));
  }
  return true;
}

export async function creditReplayPack(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    units: number;
    reference: string;
    packId: string;
    paymentRef: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return move(db, env, {
    tenantId: input.tenantId,
    amount: input.units,
    reference: input.reference,
    memo: `Session replay recordings — ${input.units.toLocaleString('en-US')} (${input.packId})`,
    accountRef: String(input.tenantId),
    entryKind: 'grant',
    metadata: {
      packId: input.packId,
      paymentRef: input.paymentRef,
      kind: 'pack',
      expiresAt: replayCreditExpiresAt(now, REPLAY_CREDIT_TTL_MONTHS).toISOString(),
    },
  }, 1);
}

export async function debitReplayCredits(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    units: number;
    reference: string;
    memo: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  return move(db, env, {
    tenantId: input.tenantId,
    amount: input.units,
    reference: input.reference,
    memo: input.memo,
    accountRef: String(input.tenantId),
    entryKind: 'spend',
    metadata: input.metadata ?? null,
  }, -1);
}

export async function debitReplayFree(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    units: number;
    reference: string;
    period: string;
    memo: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  return move(db, env, {
    tenantId: input.tenantId,
    amount: input.units,
    reference: input.reference,
    memo: input.memo,
    accountRef: `free:${input.period}`,
    entryKind: 'spend',
    metadata: input.metadata ?? null,
  }, -1);
}

export async function refundReplayCredits(
  db: Db,
  env: Env | undefined,
  input: {
    tenantId: number;
    units: number;
    reference: string;
    memo: string;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  return move(db, env, {
    tenantId: input.tenantId,
    amount: input.units,
    reference: input.reference,
    memo: input.memo,
    accountRef: String(input.tenantId),
    entryKind: 'refund',
    metadata: input.metadata ?? null,
  }, -1);
}

export async function replayCreditBalance(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  now: Date = new Date(),
): Promise<number> {
  return getOrSetCached(env, creditsKey(tenantId), async () => {
    const rows = await loadCreditRows(db, tenantId);
    return spendableCredits(rows, now);
  }, { kvTtlSeconds: 30 });
}

export async function replayFreeUsed(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  period: string,
): Promise<number> {
  return getOrSetCached(env, freeKey(tenantId, period), async () => {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(freeAccount(tenantId, period));
    // Free rows are spends (negative); used is the absolute value.
    return Math.max(0, Math.round(-Number(row?.total ?? 0)));
  }, { kvTtlSeconds: 30 });
}

export async function replayWalletSnapshot(
  db: Db,
  env: Env | undefined,
  tenantId: number,
  opts: { now?: Date; freeMonthlyUnits?: number } = {},
): Promise<ReplayWalletSnapshot> {
  const now = opts.now ?? new Date();
  const period = replayPeriod(now);
  const freeMonthly = opts.freeMonthlyUnits ?? REPLAY_FREE_MONTHLY_UNITS;
  const [credits, freeUsed] = await Promise.all([
    replayCreditBalance(db, env, tenantId, now),
    replayFreeUsed(db, env, tenantId, period),
  ]);
  return {
    credits,
    freeUsed,
    freeRemaining: Math.max(0, freeMonthly - freeUsed),
    period,
  };
}

export async function loadGrantRows(db: Db, tenantId: number): Promise<ReplayLedgerRow[]> {
  return loadCreditRows(db, tenantId);
}

/** True when this visit has already been billed (any of the visit's references). */
export async function visitAlreadyBilled(
  db: Db,
  tenantId: number,
  visitId: string,
): Promise<boolean> {
  const refs = [
    `replay-visit:${visitId}`,
    `replay-visit:${visitId}:free`,
    `replay-visit:${visitId}:credits`,
  ];
  const [row] = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(scopedToTenant(
      ledgerEntries,
      tenantId,
      eq(ledgerEntries.denomination, REPLAY_RECORDINGS_DENOMINATION),
      inArray(ledgerEntries.reference, refs),
    ))
    .limit(1);
  return Boolean(row);
}
