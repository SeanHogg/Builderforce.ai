/**
 * D2 difficulty router — the daily training sweep (PRD: LLM Cost Optimization · D2).
 *
 * Reads the recent `cascade_outcomes` rows (migration 1254), fits one head per tenant
 * that has enough of them, plus a GLOBAL head over every tenant's rows (the fallback a
 * tenant without a trusted head of its own is answered from), and caches each in KV under
 * `difficultyHeadKey` — which is all the hot path (`difficultyGate.ts`) ever reads.
 *
 * Training is the engine's ONE trainer (`trainMlTask`: chronological held-out tail,
 * `minSamples`, refit on all) running a classical logistic engine; the task row below
 * only says how a sample maps onto it. `@builderforce/difficulty-router` builds the
 * samples and reduces the fit to the binary head it stores.
 *
 * Runs regardless of the `d2_difficulty_router` lever: a head cached ahead of the rollout
 * is what lets the lever act on its first day for a tenant.
 */
import { sql } from 'drizzle-orm';
import { trainMlTask, type MlTask } from '@seanhogg/builderforce-memory-engine';
import {
  DIFFICULTY_POLICY,
  trainLogistic,
  type DifficultyExample,
  type DifficultyFeatures,
  type DifficultyHead,
  type LogisticTrainer,
} from '@builderforce/difficulty-router';
import type { Db } from '../../infrastructure/database/connection';
import { setCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { resultRows } from '../kernel/metricRollup';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { DIFFICULTY_HEAD_TTL_SECONDS, DIFFICULTY_TRAINING_DAYS, difficultyHeadKey, type DifficultyHeadScope } from './difficultyGate';

const SOURCE = 'application/llm/difficultyTraining.ts';

/** Declared beside the prior that shares the window (`difficultyGate.ts`). */
export { DIFFICULTY_TRAINING_DAYS };
/** Newest rows per tenant a head is fitted on. */
export const DIFFICULTY_ROWS_PER_TENANT = 2_000;
/** Newest rows (across tenants) the global head is fitted on. */
export const DIFFICULTY_ROWS_GLOBAL = 10_000;

/** The catalog-shaped task the engine's trainer fits: an already-featurized vector in, (passes, fails) out. */
export const WEAK_FAILURE_TASK: MlTask<number[], { fails: boolean; probability: number }> = {
  kind: 'classify',
  id: 'cascade.weak-failure',
  description: "Will the weak model's attempt at this step fail its verifier?",
  features: { numeric: (x) => x },
  engines: [{ tier: 'local', engine: 'classical', algorithm: 'logistic' }],
  train: { minSamples: DIFFICULTY_POLICY.minSamples, holdoutFraction: DIFFICULTY_POLICY.holdoutFraction },
  output: {
    labels: ['passes', 'fails'],
    decode: (p) => ({ fails: (p.scores[1] ?? 0) >= 0.5, probability: p.scores[1] ?? 0 }),
  },
};

/** The engine's trainer as the router's injected port. */
export const engineLogisticTrainer: LogisticTrainer = async (samples, spec) => {
  const task: typeof WEAK_FAILURE_TASK = {
    ...WEAK_FAILURE_TASK,
    train: { minSamples: spec.minSamples, holdoutFraction: spec.holdoutFraction },
  };
  const fit = await trainMlTask(
    task,
    samples.map((s) => ({ input: s.x, label: s.y, ...(s.weight !== undefined ? { weight: s.weight } : {}) })),
    { classical: { logistic: { classes: spec.classes } } },
  );
  const params = fit?.predictor.exportParams?.();
  return fit && params ? { params, holdoutLoss: fit.holdoutLoss, samples: fit.samples } : null;
};

/** A stored `features` value, validated; null for a malformed row (it is skipped). */
export function asDifficultyFeatures(raw: unknown): DifficultyFeatures | null {
  const v = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof f[k] === 'number' && Number.isFinite(f[k]) ? (f[k] as number) : undefined);
  if (typeof f.actionType !== 'string' || typeof f.role !== 'string') return null;
  const promptTokens = num('promptTokens');
  const toolCount = num('toolCount');
  const turnIndex = num('turnIndex');
  if (promptTokens === undefined || toolCount === undefined || turnIndex === undefined) return null;
  const repoFileCount = num('repoFileCount');
  const priorWeakPassRate = num('priorWeakPassRate');
  return {
    actionType: f.actionType,
    role: f.role,
    promptTokens,
    toolCount,
    turnIndex,
    ...(repoFileCount !== undefined ? { repoFileCount } : {}),
    ...(priorWeakPassRate !== undefined ? { priorWeakPassRate } : {}),
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null; // a malformed row is skipped by the caller, counted as `skipped`
  }
}

interface OutcomeRow {
  tenantId: number;
  example: DifficultyExample;
}

async function readRecentOutcomes(db: Db): Promise<{ rows: OutcomeRow[]; skipped: number }> {
  const raw = resultRows(await db.execute(sql`
    SELECT tenant_id, passed, features
      FROM (
        SELECT tenant_id, passed, features, created_at,
               ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at DESC) AS rn
          FROM cascade_outcomes
         WHERE created_at >= NOW() - make_interval(days => ${DIFFICULTY_TRAINING_DAYS}::int)
      ) recent
     WHERE rn <= ${DIFFICULTY_ROWS_PER_TENANT}::int
     ORDER BY created_at ASC
  `));
  const rows: OutcomeRow[] = [];
  let skipped = 0;
  for (const r of raw) {
    const features = asDifficultyFeatures(r.features);
    if (!features) {
      skipped++;
      continue;
    }
    rows.push({
      tenantId: Number(r.tenant_id),
      example: { features, failed: r.passed !== true },
    });
  }
  return { rows, skipped };
}

export interface DifficultyTrainingResult {
  rows: number;
  skipped: number;
  /** Tenants whose own head was fitted and cached. */
  tenantHeads: number;
  globalHead: boolean;
}

async function trainAndCache(env: CacheEnv, scope: DifficultyHeadScope, examples: DifficultyExample[]): Promise<DifficultyHead | null> {
  try {
    const head = await trainLogistic(examples, engineLogisticTrainer);
    if (head) await setCached(env, difficultyHeadKey(scope), head, { kvTtlSeconds: DIFFICULTY_HEAD_TTL_SECONDS });
    return head;
  } catch (error) {
    // One scope's failed fit keeps its last cached head; the others still train.
    reportCaughtError(error, { source: SOURCE, operation: 'trainAndCache', context: { scope: scope === 'global' ? 'global' : scope.tenantId } });
    return null;
  }
}

/** The sweep: one head per tenant with enough rows, and the global fallback. */
export async function runDifficultyTraining(env: CacheEnv, db: Db): Promise<DifficultyTrainingResult> {
  const { rows, skipped } = await readRecentOutcomes(db);
  const byTenant = new Map<number, DifficultyExample[]>();
  for (const r of rows) {
    const list = byTenant.get(r.tenantId) ?? [];
    list.push(r.example);
    byTenant.set(r.tenantId, list);
  }
  let tenantHeads = 0;
  for (const [tenantId, examples] of byTenant) {
    if (examples.length < DIFFICULTY_POLICY.minSamples) continue;
    if (await trainAndCache(env, { tenantId }, examples)) tenantHeads++;
  }
  // Rows arrive oldest first across every tenant, so the global held-out tail is the newest.
  const global = rows.slice(-DIFFICULTY_ROWS_GLOBAL).map((r) => r.example);
  const globalHead = global.length >= DIFFICULTY_POLICY.minSamples && (await trainAndCache(env, 'global', global)) !== null;
  return { rows: rows.length, skipped, tenantHeads, globalHead };
}
