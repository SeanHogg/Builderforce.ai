/**
 * THE Insights usage module — the free allowance, the credits and the debit, over
 * the ONE wallet (`commerce/replayWallet.ts`, PRD 33 D4 §3.3 step 4, §6 "one usage
 * meter").
 *
 * It replaces `metering/replayUsage.ts` (a hard-coded 50 recordings a month counted
 * off a table, contradicting D4). Nothing here keeps a second balance: the free
 * pool is spend against `free:yyyy-mm`, paid credits are FIFO grants on the tenant
 * account, both on `ledger_entries` (denomination `replay_recordings`). The usage
 * meter (`consumption/meters.ts`) reads {@link usageSnapshot}, and ingest enforces
 * {@link canKeepNewRecording} — the same numbers, so displayed == enforced.
 *
 * Each 2 MiB unit of a kept recording is charged ONCE under the reference
 * `replay-use:<recordingId>:<unit>`; `ledger_entries` is unique on
 * (tenant, denomination, reference), so a retried chunk can never charge twice —
 * not even if the free pool ran out between the attempt and the retry.
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { ReplayUsageDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ledgerEntries, tenants } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, peekCached, setCached } from '../../infrastructure/cache/readThroughCache';
import { parseJsonObject } from '../../domain/shared/json';
import { DAY_MS } from '../../domain/shared/time';
import { loadReplayCatalog, REPLAY_RECORDINGS_DENOMINATION, replayPeriod } from '../commerce/replayCatalog';
import {
  debitReplayCredits,
  debitReplayFree,
  loadGrantRows,
  replayWalletSnapshot,
  type ReplayWalletSnapshot,
} from '../commerce/replayWallet';
import { recordReplayTrace, REPLAY_TRACE_VERBS } from './replayTrace';
import { allowanceOverrideKey, exhaustedTraceKey, paidUsedKey } from './replayCacheKeys';

const OVERRIDE_TTL_SECONDS = 5 * 60;
const PAID_USED_TTL_SECONDS = 30;

/** The ledger reference of one charged unit — the idempotency key. */
export function replayUseReference(recordingId: string, unitIndex: number): string {
  return `replay-use:${recordingId}:${unitIndex}`;
}

/**
 * `tenants.settings.replayFreeAllowanceOverride` (D8: a validation workspace set to 0
 * so a real pack purchase is exercised). Null when unset or not a non-negative number.
 */
async function allowanceOverride(env: Env | undefined, db: Db, tenantId: number): Promise<number | null> {
  return getOrSetCached(env, allowanceOverrideKey(tenantId), async () => {
    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const value = parseJsonObject<{ replayFreeAllowanceOverride?: unknown }>(row?.settings).replayFreeAllowanceOverride;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }, { kvTtlSeconds: OVERRIDE_TTL_SECONDS });
}

/** This workspace's free recordings per month: the override, else the catalog's. */
export async function freeAllowance(env: Env | undefined, db: Db, tenantId: number): Promise<number> {
  const [override, catalog] = await Promise.all([
    allowanceOverride(env, db, tenantId),
    loadReplayCatalog(env, db),
  ]);
  return override ?? catalog.freeMonthlyUnits;
}

async function wallet(env: Env | undefined, db: Db, tenantId: number, now: Date): Promise<ReplayWalletSnapshot & { freeAllowance: number }> {
  const allowance = await freeAllowance(env, db, tenantId);
  const snapshot = await replayWalletSnapshot(db, env, tenantId, { now, freeMonthlyUnits: allowance });
  return { ...snapshot, freeAllowance: allowance };
}

function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

/** Paid units spent this period (spends on the tenant account; refunds are not use). */
async function paidUsedInPeriod(env: Env | undefined, db: Db, tenantId: number, period: string): Promise<number> {
  return getOrSetCached(env, paidUsedKey(tenantId, period), async () => {
    const { start, end } = periodBounds(period);
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(scopedToTenant(
        ledgerEntries,
        tenantId,
        eq(ledgerEntries.accountKind, 'tenant'),
        eq(ledgerEntries.accountRef, String(tenantId)),
        eq(ledgerEntries.denomination, REPLAY_RECORDINGS_DENOMINATION),
        eq(ledgerEntries.entryKind, 'spend'),
        and(gte(ledgerEntries.occurredAt, start), lt(ledgerEntries.occurredAt, end)),
      ));
    return Math.max(0, Math.round(-Number(row?.total ?? 0)));
  }, { kvTtlSeconds: PAID_USED_TTL_SECONDS });
}

/**
 * The usage the meter and the Insights plan chip show. `credits` is the REMAINING
 * balance (spends already left it), so the limit adds back this period's paid spend:
 * `limit - used` is then exactly what ingest will still allow (free remaining + credits).
 */
export async function usageSnapshot(env: Env | undefined, db: Db, tenantId: number, now: Date = new Date()): Promise<ReplayUsageDto> {
  const w = await wallet(env, db, tenantId, now);
  const paidUsed = await paidUsedInPeriod(env, db, tenantId, w.period);
  return {
    period: w.period,
    freeAllowance: w.freeAllowance,
    freeUsed: w.freeUsed,
    credits: w.credits,
    used: w.freeUsed + paidUsed,
    limit: w.freeAllowance + paidUsed + w.credits,
  };
}

/**
 * May a NEW recording be kept? A recording already in progress is always continued
 * (§3.3 step 4); only starting one needs a free unit or a credit.
 */
export async function canKeepNewRecording(env: Env | undefined, db: Db, tenantId: number, now: Date = new Date()): Promise<boolean> {
  return hasUnits(env, db, tenantId, 1, now);
}

/**
 * Can ONE pool (the free pool or the credits) cover `units` right now? A multi-unit
 * charge ({@link chargeUnits} with `units`) is never split across the two pools.
 */
export async function hasUnits(env: Env | undefined, db: Db, tenantId: number, units: number, now: Date = new Date()): Promise<boolean> {
  const w = await wallet(env, db, tenantId, now);
  return w.freeRemaining >= units || w.credits >= units;
}

/**
 * Trace `replay.allowance.exhausted` once per tenant per period. KV-gated, so the
 * once is per platform rather than per isolate in all but a race.
 */
export async function noteAllowanceExhausted(
  env: Env | undefined,
  db: Db,
  input: { tenantId: number; siteId: string; now?: Date },
): Promise<void> {
  const period = replayPeriod(input.now ?? new Date());
  const key = exhaustedTraceKey(input.tenantId, period);
  if (await peekCached<boolean>(env, key)) return;
  await setCached(env, key, true, { kvTtlSeconds: Math.round((40 * DAY_MS) / 1000) });
  await recordReplayTrace(env, db, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    verb: REPLAY_TRACE_VERBS.allowanceExhausted,
    summary: 'Recording allowance used up — new recordings stop until next month or a pack',
    metadata: { period },
  });
}

export interface ChargeResult {
  /** A ledger row was written by THIS call (false on a retry or with nothing to spend). */
  charged: boolean;
  source: 'free' | 'credits' | null;
}

/**
 * Charge ONE unit of a kept recording: the free pool first, then credits. With
 * neither left the unit goes uncharged (a recording in progress is never cut off)
 * and the exhaustion is traced.
 *
 * Another metered act (an MP4 export, 10 units) passes `units` and its own ledger
 * `reference` (`replay-export:<exportId>`) — the same idempotent write under a key of
 * its own, never a second ledger path. `units` come from ONE pool, never split.
 */
export async function chargeUnits(
  env: Env | undefined,
  db: Db,
  input: {
    tenantId: number;
    siteId: string;
    recordingId: string;
    unitIndex: number;
    now?: Date;
    units?: number;
    reference?: string;
    memo?: string;
  },
): Promise<ChargeResult> {
  const now = input.now ?? new Date();
  const units = Math.max(1, Math.ceil(input.units ?? 1));
  const w = await wallet(env, db, input.tenantId, now);
  const reference = input.reference ?? replayUseReference(input.recordingId, input.unitIndex);
  const memo = input.memo ?? `Insights recording ${input.recordingId} · unit ${input.unitIndex}`;
  const metadata = { recordingId: input.recordingId, unitIndex: input.unitIndex, siteId: input.siteId };

  if (w.freeRemaining >= units) {
    const charged = await debitReplayFree(db, env, {
      tenantId: input.tenantId, units, reference, period: w.period, memo, metadata,
    });
    if (charged && w.freeRemaining === units && w.credits === 0) {
      await noteAllowanceExhausted(env, db, { tenantId: input.tenantId, siteId: input.siteId, now });
    }
    return { charged, source: 'free' };
  }

  if (w.credits >= units) {
    const firstPaid = !(await loadGrantRows(db, input.tenantId)).some((row) => row.kind === 'spend');
    const charged = await debitReplayCredits(db, env, { tenantId: input.tenantId, units, reference, memo, metadata });
    // The credits balance is read live, the period's paid spend is cached: drop the cache with
    // the spend so `limit` (which adds the spend back) moves together with `credits`.
    if (charged) await invalidateCached(env, paidUsedKey(input.tenantId, w.period));
    if (charged && firstPaid) {
      await recordReplayTrace(env, db, {
        tenantId: input.tenantId,
        siteId: input.siteId,
        verb: REPLAY_TRACE_VERBS.creditsFirstDebit,
        summary: 'First recording paid from credits',
        metadata: { recordingId: input.recordingId, unitIndex: input.unitIndex },
      });
    }
    if (charged && w.credits === units) {
      await noteAllowanceExhausted(env, db, { tenantId: input.tenantId, siteId: input.siteId, now });
    }
    return { charged, source: 'credits' };
  }

  if (w.freeRemaining <= 0 && w.credits <= 0) {
    await noteAllowanceExhausted(env, db, { tenantId: input.tenantId, siteId: input.siteId, now });
  }
  return { charged: false, source: null };
}
