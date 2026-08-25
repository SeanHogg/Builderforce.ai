/**
 * What the AI actually did, and what it cost (PRD 19 §9).
 *
 * Four tables Builderforce declared and never read, all answering the same
 * question from different angles — is the AI earning its keep:
 *
 *   `ai_tool_calls`             every tool invocation, its arguments, its outcome.
 *   `ai_email_classifications`  a label applied to a message, with confidence.
 *   `ai_competitors`            a competitor the AI researched and positioned.
 *   `enrichment_cache`          a provider response reused instead of re-bought.
 *
 * ── THE CACHE IS THE ONLY ONE THAT PAYS FOR ITSELF DIRECTLY ─────────────────
 * `enrichment_cache.cost_cents_avoided` and `hit_count` exist so a workspace can
 * see money it did NOT spend. {@link cacheSavings} is the read, and it is the
 * reason {@link cacheLookup} increments `hit_count` on the read path rather than
 * leaving it to a caller: a cache whose hits are counted by whoever remembers to
 * is a cache whose savings are always understated.
 *
 * ── EXPIRY IS ENFORCED ON READ, NOT BY A SWEEP ──────────────────────────────
 * {@link cacheLookup} filters on `expires_at` in the query. A sweep that deletes
 * expired rows is still worth having for space, but correctness must not depend
 * on it having run — a stale enrichment served because the sweep was late is a
 * wrong phone number sent to a customer.
 *
 * ── A CLASSIFICATION IS A CLAIM, AND CLAIMS GET SCORED ──────────────────────
 * `ai_email_classifications` carries `confidence` and `model`, so
 * {@link classificationMix} can report the distribution per model. Same principle
 * as churn calibration: a model nobody scores is a number that always sounds
 * plausible.
 *
 * ── TOOL CALLS ARE HIGH-VOLUME, SO THE READS ARE AGGREGATES ────────────────
 * {@link toolUsage} groups rather than listing. A per-call list is what
 * `activity_log` and the run transcript are for; what an operator needs from this
 * table is which tools fail, which are slow, and which are never used.
 */

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  aiCompetitors,
  aiEmailClassifications,
  aiToolCalls,
  enrichmentCache,
} from '../../infrastructure/database/schema';
import { scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';

/** `ai_tool_calls.outcome`. */
export const TOOL_OUTCOMES = ['ok', 'error', 'refused', 'timeout'] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

export const isToolOutcome = (v: unknown): v is ToolOutcome =>
  typeof v === 'string' && (TOOL_OUTCOMES as readonly string[]).includes(v);

export class AiOpsError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'AiOpsError';
  }
}

// ── Tool calls ──────────────────────────────────────────────────────────────

export async function recordToolCall(
  db: Db,
  tenantId: number,
  input: {
    toolName: string;
    outcome?: ToolOutcome;
    runRef?: string | null;
    messageRef?: string | null;
    arguments?: unknown;
    result?: unknown;
  },
) {
  const outcome = input.outcome ?? 'ok';
  if (!isToolOutcome(outcome)) throw new AiOpsError(`outcome must be one of: ${TOOL_OUTCOMES.join(', ')}`);
  const [row] = await db
    .insert(aiToolCalls)
    .values({
      tenantId,
      toolName: input.toolName.trim().slice(0, 96),
      outcome,
      runRef: input.runRef ?? null,
      messageRef: input.messageRef ?? null,
      arguments: input.arguments ?? null,
      result: input.result ?? null,
    })
    .returning();
  if (!row) throw new AiOpsError('could not record the tool call');
  return row;
}

/**
 * Which tools fail, and how often.
 *
 * `refused` is reported apart from `error`, and the distinction matters more than
 * it looks: a refusal is the guardrail working, an error is the tool broken. A
 * single failure rate that blends them makes a well-guarded tool look unreliable
 * and hides a genuinely broken one behind a plausible refusal rate.
 */
export async function toolUsage(db: Db, tenantId: number) {
  return db
    .select({
      toolName: aiToolCalls.toolName,
      calls: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${aiToolCalls.outcome} = 'ok')::int`,
      errors: sql<number>`count(*) filter (where ${aiToolCalls.outcome} = 'error')::int`,
      refused: sql<number>`count(*) filter (where ${aiToolCalls.outcome} = 'refused')::int`,
      timeouts: sql<number>`count(*) filter (where ${aiToolCalls.outcome} = 'timeout')::int`,
      errorRate: sql<number>`(count(*) filter (where ${aiToolCalls.outcome} = 'error')::float8 / nullif(count(*), 0))`,
    })
    .from(aiToolCalls)
    .where(scopedToTenant(aiToolCalls, tenantId))
    .groupBy(aiToolCalls.toolName)
    .orderBy(desc(sql`count(*)`));
}

/** Every tool call in one run — the transcript view, bounded by the run so it
 *  cannot become an unbounded scan of a high-volume table. */
export async function callsForRun(db: Db, tenantId: number, runRef: string) {
  return db
    .select()
    .from(aiToolCalls)
    .where(scopedToTenant(aiToolCalls, tenantId, eq(aiToolCalls.runRef, runRef.trim())))
    .orderBy(aiToolCalls.id);
}

// ── Email classification ────────────────────────────────────────────────────

export async function classifyMessage(
  db: Db,
  tenantId: number,
  input: { messageRef: string; label: string; confidence?: number | null; intent?: string | null; entities?: unknown; model: string },
) {
  const model = input.model.trim();
  if (!model) throw new AiOpsError('model is required — a label with no model has no provenance');
  const [row] = await db
    .insert(aiEmailClassifications)
    .values({
      tenantId,
      messageRef: input.messageRef.trim().slice(0, 64),
      label: input.label.trim().slice(0, 32),
      confidence: input.confidence === null || input.confidence === undefined ? null : String(input.confidence),
      intent: input.intent ?? null,
      entities: input.entities ?? null,
      model: model.slice(0, 96),
    })
    .returning();
  if (!row) throw new AiOpsError('could not classify the message');
  return row;
}

/**
 * The label distribution per model, with mean confidence.
 *
 * Per MODEL, because that is the only way to notice that a new model has started
 * labelling everything `spam` at 0.99 — an aggregate across models averages the
 * problem away exactly when it appears.
 */
export async function classificationMix(db: Db, tenantId: number) {
  return db
    .select({
      model: aiEmailClassifications.model,
      label: aiEmailClassifications.label,
      messages: sql<number>`count(*)::int`,
      avgConfidence: sql<number | null>`avg(${aiEmailClassifications.confidence})::float8`,
      lowConfidence: sql<number>`count(*) filter (where ${aiEmailClassifications.confidence} < 0.5)::int`,
    })
    .from(aiEmailClassifications)
    .where(scopedToTenant(aiEmailClassifications, tenantId))
    .groupBy(aiEmailClassifications.model, aiEmailClassifications.label)
    .orderBy(desc(sql`count(*)`));
}

/** The labels applied to one message, newest first. Plural because re-classifying
 *  appends — the label the workflow acted on has to survive a later re-run. */
export async function labelsFor(db: Db, tenantId: number, messageRef: string) {
  return db
    .select()
    .from(aiEmailClassifications)
    .where(scopedToTenant(aiEmailClassifications, tenantId, eq(aiEmailClassifications.messageRef, messageRef.trim())))
    .orderBy(desc(aiEmailClassifications.id));
}

// ── Competitors ─────────────────────────────────────────────────────────────

export async function upsertCompetitor(
  db: Db,
  tenantId: number,
  input: { id?: number; name: string; website?: string | null; category?: string | null; positioning?: string | null; strengths?: unknown; weaknesses?: unknown },
) {
  const values = {
    tenantId,
    name: input.name.trim().slice(0, 200),
    website: input.website ?? null,
    category: input.category ?? null,
    positioning: input.positioning ?? null,
    strengths: input.strengths ?? null,
    weaknesses: input.weaknesses ?? null,
  };
  const [row] = input.id
    ? await db.update(aiCompetitors).set({ ...values, updatedAt: new Date() })
      .where(scopedToTenant(aiCompetitors, tenantId, eq(aiCompetitors.id, input.id))).returning()
    : await db.insert(aiCompetitors).values(values).returning();
  if (!row) throw new AiOpsError('competitor not found', 404);
  return row;
}

export async function listCompetitors(db: Db, tenantId: number, category?: string) {
  return db
    .select()
    .from(aiCompetitors)
    .where(scopedToTenant(aiCompetitors, tenantId, category ? eq(aiCompetitors.category, category) : undefined))
    .orderBy(aiCompetitors.name);
}

// ── Enrichment cache ────────────────────────────────────────────────────────

/**
 * Look up a cached provider response, counting the hit.
 *
 * Expiry is applied in the QUERY — see the module docstring. The hit counter is
 * incremented here rather than by the caller so that {@link cacheSavings} cannot
 * be quietly understated by a call site that forgot.
 *
 * `tenant_id` is nullable because some enrichment is genuinely platform-wide (a
 * public company record is the same for everyone), so this uses the
 * nullable-tenant helper and a null lookup never reads a tenant's private rows.
 */
export async function cacheLookup(db: Db, tenantId: number | null, provider: string, requestHash: string) {
  const [row] = await db
    .select()
    .from(enrichmentCache)
    .where(scopedToNullableTenant(enrichmentCache, tenantId, and(
      eq(enrichmentCache.provider, provider.trim()),
      eq(enrichmentCache.requestHash, requestHash.trim()),
      // Correctness must not depend on a sweep having run.
      or(isNull(enrichmentCache.expiresAt), sql`${enrichmentCache.expiresAt} > now()`),
    )))
    .limit(1);
  if (!row) return null;

  await db
    .update(enrichmentCache)
    .set({ hitCount: sql`${enrichmentCache.hitCount} + 1` })
    .where(scopedToNullableTenant(enrichmentCache, tenantId, eq(enrichmentCache.id, row.id)));

  return { ...row, hitCount: row.hitCount + 1 };
}

/**
 * Store a provider response.
 *
 * `costCentsAvoided` is what the NEXT hit will save, recorded at write time
 * because that is when the price is known. Upserts on (provider, request_hash)
 * so a re-fetch refreshes rather than duplicating — two rows for one request
 * means half the hits never find the newer one.
 */
export async function cacheStore(
  db: Db,
  tenantId: number | null,
  input: { provider: string; requestHash: string; payload: unknown; costCentsAvoided?: number; ttlSeconds?: number },
) {
  const expiresAt = input.ttlSeconds
    ? new Date(Date.now() + input.ttlSeconds * 1000)
    : null;

  const [existing] = await db
    .select({ id: enrichmentCache.id })
    .from(enrichmentCache)
    .where(scopedToNullableTenant(enrichmentCache, tenantId, and(
      eq(enrichmentCache.provider, input.provider.trim()),
      eq(enrichmentCache.requestHash, input.requestHash.trim()),
    )))
    .limit(1);

  const values = {
    tenantId,
    provider: input.provider.trim().slice(0, 64),
    requestHash: input.requestHash.trim().slice(0, 64),
    payload: input.payload ?? null,
    costCentsAvoided: input.costCentsAvoided ?? 0,
    expiresAt,
  };

  const [row] = existing
    ? await db.update(enrichmentCache).set(values)
      .where(scopedToNullableTenant(enrichmentCache, tenantId, eq(enrichmentCache.id, existing.id))).returning()
    : await db.insert(enrichmentCache).values(values).returning();
  if (!row) throw new AiOpsError('could not store the cache entry');
  return row;
}

/**
 * Money not spent.
 *
 * `hit_count` times `cost_cents_avoided`, per provider — the first hit is the one
 * that saved nothing (it paid for the entry), so savings are computed over hits
 * rather than over entries. Reporting entries would credit the cache for every
 * response it stored and never reused.
 */
export async function cacheSavings(db: Db, tenantId: number | null) {
  return db
    .select({
      provider: enrichmentCache.provider,
      entries: sql<number>`count(*)::int`,
      hits: sql<number>`coalesce(sum(${enrichmentCache.hitCount}), 0)::int`,
      centsAvoided: sql<number>`coalesce(sum(${enrichmentCache.hitCount} * ${enrichmentCache.costCentsAvoided}), 0)::int`,
      live: sql<number>`count(*) filter (
        where ${enrichmentCache.expiresAt} is null or ${enrichmentCache.expiresAt} > now()
      )::int`,
    })
    .from(enrichmentCache)
    .where(scopedToNullableTenant(enrichmentCache, tenantId))
    .groupBy(enrichmentCache.provider)
    .orderBy(desc(sql`coalesce(sum(${enrichmentCache.hitCount} * ${enrichmentCache.costCentsAvoided}), 0)`));
}

/** Drop expired entries. Space housekeeping only — {@link cacheLookup} already
 *  refuses to serve them, so this can be late without being wrong. */
export async function purgeExpired(db: Db, tenantId: number | null) {
  const rows = await db
    .delete(enrichmentCache)
    .where(scopedToNullableTenant(enrichmentCache, tenantId, sql`${enrichmentCache.expiresAt} < now()`))
    .returning({ id: enrichmentCache.id });
  return { purged: rows.length };
}
