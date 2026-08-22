/**
 * THE POINTS LEDGER — reads and writes in the `points` denomination.
 *
 * ── WHY THERE IS NO BALANCE TABLE ────────────────────────────────────────────
 * The source product carried `user_points_balance` beside `points_ledger`: a
 * stored total and the movements that produce it, which is a fact its own rows
 * can contradict. The coverage map files both onto `ledger_entries`, and this
 * module is the reason that is not merely tidier — a balance here is a SUM over
 * an account, served through the read-through cache and invalidated on write, so
 * there is exactly one answer to "how many points does this person have" and it
 * is derived from the movements that justify it.
 *
 * That is the same trade `PayoutAccountService.paidCents` already makes for
 * money, and it is the trade the platform's caching rule exists to pay for: the
 * scan is real, so it is cached, and every writer here invalidates.
 *
 * ── IDEMPOTENCY IS THE REFERENCE, NOT A LOOKUP ───────────────────────────────
 * `ledger_entries` has a unique index on (tenant, denomination, reference). So a
 * points award composes its reference from the earner, the action and the caller's
 * own event id, and inserts with `onConflictDoNothing`. A retried webhook, a
 * double-clicked button and a replayed queue message all collapse to one row
 * WITHOUT a read-then-write race, because the database decides, not the engine.
 *
 * The reference is `pts:<user>:<action>:<ref>`, in that order deliberately: the
 * unique index is a btree, so that prefix makes "what has this person earned from
 * this action" an index range scan rather than a jsonb filter. The daily-cap and
 * badge-threshold reads below are exactly that query, which is why the layout is
 * a correctness-and-performance decision rather than a formatting one.
 *
 * ── WHAT `entryKind` MEANS HERE ──────────────────────────────────────────────
 * `grant` earned (including streak and badge bonuses) · `spend` redeemed ·
 * `refund` reversed by the fraud path · `adjustment` written by an operator.
 * The kernel's vocabulary, unextended: points needed no new kind.
 */

import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries } from '../../infrastructure/database/schema';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { POINTS } from '../kernel/denominations';

/** `ledger_entries.reference` is varchar(160). A composed reference that would
 *  overflow is truncated on the CALLER's ref rather than silently rejected by
 *  the database — but truncation must not merge two distinct events, so the
 *  overflow case keeps a hash of the full ref instead of a prefix of it. */
const REFERENCE_MAX = 160;

export type PointsEntryKind = 'grant' | 'spend' | 'refund' | 'adjustment';

export interface PointsEntry {
  id: number;
  amount: number;
  entryKind: string;
  action: string;
  source: string;
  memo: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

/** Deterministic, collision-safe reference for one earning event. */
export function pointsReference(userId: string, action: string, refId?: string | null): string {
  const head = `pts:${userId}:${action}:`;
  const tail = refId ?? '-';
  if (head.length + tail.length <= REFERENCE_MAX) return head + tail;
  // Keep the prefix intact (the range scan depends on it) and compress the tail.
  const budget = REFERENCE_MAX - head.length;
  return head + fnv1a(tail).padStart(Math.min(budget, 16), '0').slice(0, Math.max(budget, 1));
}

/** Small, dependency-free, stable hash. Not cryptographic — it only has to keep
 *  two different caller refs from composing the same reference. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The prefix that selects every entry a person has from ONE action. */
function actionPrefix(userId: string, action: string): string {
  return `pts:${userId}:${action}:`;
}

const balanceKey = (tenantId: number, userId: string) => `points:balance:t:${tenantId}:u:${userId}`;

/** Everything a points write must orphan. One list, so a new writer cannot
 *  invalidate half of it. */
export async function invalidatePointsCaches(env: Env, tenantId: number, userId: string): Promise<void> {
  await Promise.all([
    invalidateCached(env, balanceKey(tenantId, userId)),
    invalidateCached(env, `points:summary:t:${tenantId}:u:${userId}`),
    invalidateCached(env, `points:leaderboard:t:${tenantId}`),
  ]);
}

/**
 * The person's current balance. Cached 60s — an aggregate scan that does not
 * need to be to-the-second, and every writer in this module invalidates it, so
 * the TTL is a backstop rather than the correctness mechanism.
 */
export async function pointsBalance(db: Db, env: Env, tenantId: number, userId: string): Promise<number> {
  return getOrSetCached(env, balanceKey(tenantId, userId), async () => {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
      .from(ledgerEntries)
      .where(pointsAccount(tenantId, userId));
    return Math.round(Number(row?.total ?? 0));
  }, { kvTtlSeconds: 60 });
}

function pointsAccount(tenantId: number, userId: string) {
  return and(
    eq(ledgerEntries.tenantId, tenantId),
    eq(ledgerEntries.accountKind, 'user'),
    eq(ledgerEntries.accountRef, userId),
    eq(ledgerEntries.denomination, POINTS),
  );
}

/** Points earned from ONE action since `since`. Feeds the daily cap; not cached,
 *  because the value it gates is written in the same request. */
export async function pointsEarnedForActionSince(
  db: Db, tenantId: number, userId: string, action: string, since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(
      pointsAccount(tenantId, userId),
      eq(ledgerEntries.entryKind, 'grant'),
      like(ledgerEntries.reference, `${actionPrefix(userId, action)}%`),
      gte(ledgerEntries.occurredAt, since),
    ));
  return Math.round(Number(row?.total ?? 0));
}

/** Lifetime count of QUALIFYING awards of one action — the badge thresholds'
 *  input. Zero-point rows (a capped or gated attempt) are excluded: a badge
 *  earned by an attempt that paid nothing would be a badge for being blocked. */
export async function pointsAwardCount(
  db: Db, tenantId: number, userId: string, action: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(ledgerEntries)
    .where(and(
      pointsAccount(tenantId, userId),
      eq(ledgerEntries.entryKind, 'grant'),
      like(ledgerEntries.reference, `${actionPrefix(userId, action)}%`),
      sql`${ledgerEntries.amount} > 0`,
    ));
  return Number(row?.n ?? 0);
}

export interface WritePointsInput {
  tenantId: number;
  userId: string;
  amount: number;
  entryKind: PointsEntryKind;
  action: string;
  source: string;
  refId?: string | null;
  memo?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write one points movement. Returns `false` when the reference already existed
 * — the caller's event had already been counted — so a caller can distinguish
 * "awarded" from "already awarded" without a pre-read.
 */
export async function writePointsEntry(db: Db, env: Env, input: WritePointsInput): Promise<boolean> {
  const inserted = await db.insert(ledgerEntries).values({
    tenantId: input.tenantId,
    accountKind: 'user',
    accountRef: input.userId,
    denomination: POINTS,
    amount: String(input.amount),
    entryKind: input.entryKind,
    reference: pointsReference(input.userId, input.action, input.refId),
    memo: input.memo ?? null,
    metadata: { action: input.action, source: input.source, ...(input.metadata ?? {}) },
  }).onConflictDoNothing().returning({ id: ledgerEntries.id });

  if (inserted.length === 0) return false;
  await invalidatePointsCaches(env, input.tenantId, input.userId);
  return true;
}

/** The activity feed: newest movements, whatever their kind. */
export async function recentPointsEntries(
  db: Db, tenantId: number, userId: string, limit = 25,
): Promise<PointsEntry[]> {
  const rows = await db
    .select({
      id: ledgerEntries.id,
      amount: ledgerEntries.amount,
      entryKind: ledgerEntries.entryKind,
      memo: ledgerEntries.memo,
      metadata: ledgerEntries.metadata,
      occurredAt: ledgerEntries.occurredAt,
    })
    .from(ledgerEntries)
    .where(pointsAccount(tenantId, userId))
    .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((row) => {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      id: Number(row.id),
      amount: Math.round(Number(row.amount)),
      entryKind: row.entryKind,
      action: typeof meta.action === 'string' ? meta.action : 'unknown',
      source: typeof meta.source === 'string' ? meta.source : 'unknown',
      memo: row.memo,
      metadata: meta,
      occurredAt: (row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)).toISOString(),
    };
  });
}
