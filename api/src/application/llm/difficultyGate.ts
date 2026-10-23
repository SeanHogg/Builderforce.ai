/**
 * D2 difficulty router — the cascade's two calls (PRD: LLM Cost Optimization · D2).
 *
 *   • {@link shouldSkipWeakAttempt} — before the D1 cascade tries the weak model on a
 *     step: is the trained head confident (P(weak fails) above the policy's threshold)
 *     that the attempt would fail its verifier? Then skip straight to the strong tier
 *     and save the wasted attempt. Lever `d2_difficulty_router`; off, cold, or an
 *     untrusted head ⇒ false (today's behaviour). The HOT PATH reads only the head the
 *     daily sweep cached in KV (tenant head, else the global one) — never the database.
 *   • {@link recordCascadeOutcome} — after the verifier judged a weak attempt: one
 *     `cascade_outcomes` row (migration 1254), the training data. Written whether or
 *     not D2 is on for the tenant, so a head is ready the day the lever reaches it (the
 *     caller, the D1 cascade, is itself gated by `d1_verifier_cascade`). Never throws.
 *   • {@link weakPassRate} — the head's `priorWeakPassRate` feature: the share of a
 *     tenant's weak attempts at one action type that passed, over the training window.
 *     A cached aggregate (read once per run by the cascade). Undefined on too little
 *     evidence or a failed read — the head treats an unset prior as 0.5.
 *
 * The model, policy and prediction are `@builderforce/difficulty-router`'s; training is
 * `difficultyTraining.ts`.
 */
import { isCostLeverOn } from '@builderforce/cost-levers';
import {
  DIFFICULTY_HEAD_VERSION,
  headTrusted,
  parseDifficultyHead,
  skipWeakAttempt,
  type DifficultyFeatures,
  type DifficultyHead,
} from '@builderforce/difficulty-router';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { cascadeOutcomes } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, peekCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { DAY_MS } from '../../domain/shared/time';

const SOURCE = 'application/llm/difficultyGate.ts';

/** Rows older than this teach nothing about today's weak models — the window both the
 *  training sweep (`difficultyTraining.ts`) and the {@link weakPassRate} prior read. */
export const DIFFICULTY_TRAINING_DAYS = 30;

/** Whose head a cache entry is: one tenant's, or the global fallback. */
export type DifficultyHeadScope = { tenantId: number } | 'global';

/**
 * The KV key of a cached head. The head version is in the key, so a feature-layout change
 * (a bump of `DIFFICULTY_HEAD_VERSION`) orphans every old head at once.
 */
export function difficultyHeadKey(scope: DifficultyHeadScope): string {
  const who = scope === 'global' ? 'global' : `t:${scope.tenantId}`;
  return `difficulty:head:v${DIFFICULTY_HEAD_VERSION}:${who}`;
}

/** Heads live a little over three sweeps, so one missed day keeps the last good head. */
export const DIFFICULTY_HEAD_TTL_SECONDS = 3 * 86_400 + 3_600;

async function readHead(env: CacheEnv, scope: DifficultyHeadScope): Promise<DifficultyHead | null> {
  return parseDifficultyHead(await peekCached<unknown>(env, difficultyHeadKey(scope)));
}

/** The head that answers for `tenantId`: its own when trusted, else the global one. */
export async function difficultyHeadFor(env: unknown, tenantId: number | null): Promise<DifficultyHead | null> {
  const cacheEnv = env as CacheEnv;
  if (tenantId !== null) {
    const own = await readHead(cacheEnv, { tenantId });
    if (headTrusted(own)) return own;
  }
  return readHead(cacheEnv, 'global');
}

export async function shouldSkipWeakAttempt(
  env: unknown,
  tenantId: number | null,
  f: DifficultyFeatures,
  opts: { random?: () => number } = {},
): Promise<boolean> {
  if (!isCostLeverOn(env, 'd2_difficulty_router', tenantId)) return false;
  try {
    return skipWeakAttempt(await difficultyHeadFor(env, tenantId), f, opts.random ? { random: opts.random } : {});
  } catch (error) {
    // A cache read that failed is reported and the weak model is tried — the router
    // never blocks a step.
    reportCaughtError(error, { source: SOURCE, operation: 'shouldSkipWeakAttempt', context: { tenantId }, level: 'warning' });
    return false;
  }
}

/** One weak attempt the cascade's verifier judged. */
export interface CascadeOutcome {
  tenantId: number;
  executionId: string;
  actionType: string;
  role: string;
  weakModel: string;
  passed: boolean;
  /** Which verifier judged it, e.g. `tests`, `schema`, `llm-judge`. */
  verifier: string;
  /** The step's features as the cascade saw them BEFORE the attempt. */
  features: DifficultyFeatures;
}

export async function recordCascadeOutcome(_env: unknown, db: unknown, o: CascadeOutcome): Promise<void> {
  try {
    await (db as Db).insert(cascadeOutcomes).values({
      tenantId: o.tenantId,
      executionId: o.executionId.slice(0, 128),
      actionType: o.actionType.slice(0, 32),
      role: o.role.slice(0, 16),
      weakModel: o.weakModel.slice(0, 200),
      passed: o.passed,
      verifier: o.verifier.slice(0, 64),
      features: o.features,
    });
  } catch (error) {
    // A lost training row costs the head one sample, never the run.
    reportCaughtError(error, {
      source: SOURCE,
      operation: 'recordCascadeOutcome',
      context: { tenantId: o.tenantId, executionId: o.executionId },
      level: 'warning',
    });
  }
}

/** Fewer judged attempts than this is not a rate — the prior stays unset. */
export const WEAK_PASS_MIN_SAMPLES = 5;

/** Cache key of one (tenant, action type) pass rate. The `v1` orphans every entry if
 *  the aggregate's meaning ever changes. */
export const weakPassRateKey = (tenantId: number, actionType: string): string =>
  `difficulty:weak-pass:v1:t:${tenantId}:${actionType}`;

/**
 * The share of `tenantId`'s weak attempts at `actionType` that passed their verifier
 * over the last {@link DIFFICULTY_TRAINING_DAYS} days of `cascade_outcomes` — the D2
 * head's `priorWeakPassRate`. Cached for an hour (it moves by a sample per judged step);
 * undefined below {@link WEAK_PASS_MIN_SAMPLES} or when the read failed.
 */
export async function weakPassRate(env: unknown, db: unknown, tenantId: number, actionType: string): Promise<number | undefined> {
  try {
    const cached = await getOrSetCached(env as CacheEnv, weakPassRateKey(tenantId, actionType), async () => {
      const since = new Date(Date.now() - DIFFICULTY_TRAINING_DAYS * DAY_MS);
      const [row] = await (db as Db)
        .select({
          total: sql<number>`count(*)::int`,
          passed: sql<number>`count(*) filter (where ${cascadeOutcomes.passed})::int`,
        })
        .from(cascadeOutcomes)
        .where(scopedToTenant(cascadeOutcomes, tenantId, and(eq(cascadeOutcomes.actionType, actionType.slice(0, 32)), gte(cascadeOutcomes.createdAt, since))));
      const total = Number(row?.total ?? 0);
      // Wrapped so "no evidence" is a cacheable value rather than a miss re-queried every run.
      return { rate: total >= WEAK_PASS_MIN_SAMPLES ? Number(row?.passed ?? 0) / total : null };
    }, { kvTtlSeconds: 3_600, l1TtlMs: 300_000 });
    return typeof cached.rate === 'number' && Number.isFinite(cached.rate) ? cached.rate : undefined;
  } catch (error) {
    // A failed read leaves the prior unset — the cascade never blocks on it.
    reportCaughtError(error, { source: SOURCE, operation: 'weakPassRate', context: { tenantId, actionType }, level: 'warning' });
    return undefined;
  }
}
