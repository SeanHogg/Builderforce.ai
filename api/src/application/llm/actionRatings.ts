/**
 * Human ratings of model output — the capture, the rollup, and the pure maths
 * that turns thumbs into a number the router can rank on.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `run_model_outcomes` already answers "which model SHIPS?" from merges and CI.
 * It cannot answer "which model is good at THIS?" for the vast majority of model
 * calls — chat turns, canvas turns, tool executions — because none of those have
 * a run, a PR or a CI result. For those the only quality signal that exists is
 * the one a person gives by pressing a thumb, and until migration 0468 that press
 * was written into a JSON blob on the message and never read again.
 *
 * ── THE TWO AXES ────────────────────────────────────────────────────────────
 * Every rating is filed against (action_type, tool_name) × model:
 *   • action_type — the closed taxonomy the learned router ranks on, so a rating
 *     and a cloud-run outcome land in the SAME bucket and can be blended.
 *   • tool_name   — WHICH MCP tool the rated turn executed, when it executed one.
 *     This is the axis the taxonomy cannot express and the one the question "some
 *     models are better at specific tasks" is really about.
 *
 * ── LAYERING ────────────────────────────────────────────────────────────────
 * Pure functions first ({@link ratingScore}, {@link summarizeRatingRows}) so the
 * maths is unit-testable without a database; the DB-touching capture and rollup
 * follow. Routes call only the two exported use cases — they never see a table.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { llmActionRatings } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToNullableTenant, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { normalizeActionType, type ActionType } from './actionTypes';
import { ratingScore } from './modelQualityScore';
import { applyRatingToRoutingTable, ROUTING_WINDOW_DAYS } from './routingTable';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Where the press happened. A canvas turn and a coding run are rated against
 *  very different expectations, so the summary can split by this. */
export const RATING_SURFACES = ['brain', 'canvas', 'vscode', 'execution'] as const;
export type RatingSurface = (typeof RATING_SURFACES)[number];

/** What was rated: a whole assistant reply, or one tool execution inside it. */
export const RATING_SUBJECT_KINDS = ['turn', 'tool'] as const;
export type RatingSubjectKind = (typeof RATING_SUBJECT_KINDS)[number];

/** +1 up, -1 down, 0 = the user cleared their vote (the row is deleted). */
export type RatingValue = 1 | -1 | 0;

export interface ActionRatingInput {
  surface?: string;
  subjectKind?: string;
  /** The rated thing's id in its own surface (brain message id, canvas client
   *  message id, tool-call id). Required — it is the idempotency key. */
  subjectRef: string;
  /** The model that actually served the rated turn (gateway-resolved). Required:
   *  a rating with no model attribution teaches nothing and would only dilute
   *  whichever model the summary guessed. */
  resolvedModel: string;
  actionType?: string;
  /** The MCP tool the rated turn executed, when it executed one. */
  toolName?: string | null;
  projectId?: number | null;
  rating: RatingValue;
  comment?: string | null;
}

const clampText = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v.trim().slice(0, max) : '');

function normalizeSurface(v: unknown): RatingSurface {
  return (RATING_SURFACES as readonly string[]).includes(v as string) ? (v as RatingSurface) : 'brain';
}

function normalizeSubjectKind(v: unknown): RatingSubjectKind {
  return (RATING_SUBJECT_KINDS as readonly string[]).includes(v as string) ? (v as RatingSubjectKind) : 'turn';
}

/** Coerce any inbound rating value to +1 / -1 / 0 (clear). */
export function normalizeRatingValue(v: unknown): RatingValue {
  if (v === 1 || v === '1' || v === 'up' || v === true) return 1;
  if (v === -1 || v === '-1' || v === 'down' || v === false) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Pure: rows → a ranked summary. The score itself is the SHARED
// `ratingScore` (modelQualityScore.ts) — the same smoothing the router blends
// with, so the panel can never rank models differently from the thing that
// actually picks them.
// ---------------------------------------------------------------------------

/** One (model × action × tool) bucket in the summary. */
export interface RatingBucket {
  model: string;
  actionType: ActionType;
  /** Null when the rated turns executed no tool (prose-only replies). */
  toolName: string | null;
  up: number;
  down: number;
  /** Total presses — `up + down`, carried so a consumer never re-derives it. */
  total: number;
  /** Smoothed 0..1 satisfaction (see {@link ratingScore}). */
  score: number;
}

/** The shape the rollup query returns, before scoring. */
export interface RatingRow {
  model: string;
  actionType: string;
  toolName: string | null;
  up: number;
  down: number;
}

/**
 * Score and rank raw rollup rows: best-first by smoothed score, ties broken by
 * volume (more evidence wins) and then by name so the output is deterministic.
 * PURE, so the admin panel's ordering and the router's ordering are one rule.
 */
export function summarizeRatingRows(rows: readonly RatingRow[]): RatingBucket[] {
  return rows
    .map((r) => {
      const up = Number(r.up) || 0;
      const down = Number(r.down) || 0;
      return {
        model: r.model,
        actionType: normalizeActionType(r.actionType),
        toolName: r.toolName || null,
        up,
        down,
        total: up + down,
        score: ratingScore(up, down),
      };
    })
    .sort((a, b) => b.score - a.score || b.total - a.total || a.model.localeCompare(b.model));
}

/**
 * The headline every rating summary leads with: for each action bucket, the model
 * humans actually preferred, and by how much over the runner-up. This is the
 * answer to "which LLM is better at which task" — the reason ratings are
 * collected at all — so it is computed once here rather than eyeballed off a
 * table by whoever opens the panel.
 *
 * A bucket with only one rated model has no comparison to make and is omitted:
 * "X is best at Y, out of one candidate" is not a finding.
 */
export interface RatingLeader {
  actionType: ActionType;
  toolName: string | null;
  winner: RatingBucket;
  runnerUp: RatingBucket;
  /** Score gap, 0..1 — how much better the winner scored. */
  margin: number;
}

export function ratingLeaders(buckets: readonly RatingBucket[]): RatingLeader[] {
  const byAction = new Map<string, RatingBucket[]>();
  for (const b of buckets) {
    // Grouped by action AND tool: the two axes a "which model is best at X" verdict needs.
    const key = `${b.actionType}|${b.toolName ?? ''}`;
    const group = byAction.get(key);
    if (group) group.push(b);
    else byAction.set(key, [b]);
  }
  const leaders: RatingLeader[] = [];
  for (const group of byAction.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => b.score - a.score || b.total - a.total);
    const [winner, runnerUp] = ranked as [RatingBucket, RatingBucket];
    leaders.push({
      actionType: winner.actionType,
      toolName: winner.toolName,
      winner,
      runnerUp,
      margin: winner.score - runnerUp.score,
    });
  }
  return leaders.sort((a, b) => b.margin - a.margin || b.winner.total - a.winner.total);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/** Cache key for a scope's rollup. `days` is folded in so two windows never
 *  share an entry. */
function summaryKey(tenantId: number | null, days: number): string {
  return `llm-ratings:${tenantId ?? 'global'}:${days}`;
}

/**
 * Record ONE human rating and fold it into the learned routing table.
 *
 * Idempotent per (tenant, subject, rater): pressing the same thumb twice updates
 * that person's row; pressing the opposite one flips it; clearing it deletes the
 * row. Best-effort by design — a rating is telemetry, and losing one must never
 * fail the click that produced it — but it returns the resulting state so the
 * caller can echo it back to the UI.
 */
export async function recordActionRating(
  env: Env,
  db: Db,
  ctx: { tenantId: number | null; userId: string; plan: string },
  input: ActionRatingInput,
): Promise<{ ok: true; rating: RatingValue } | { ok: false; error: string }> {
  const subjectRef = clampText(input.subjectRef, 128);
  if (!subjectRef) return { ok: false, error: 'subjectRef is required' };
  const resolvedModel = clampText(input.resolvedModel, 200);
  const rating = normalizeRatingValue(input.rating);
  // A rating with no model attribution cannot teach anything and would only add
  // noise to whichever bucket we guessed — refuse it rather than store a lie.
  // (Clearing a vote needs no model: the row is being removed.)
  if (!resolvedModel && rating !== 0) return { ok: false, error: 'resolvedModel is required' };

  const subjectKind = normalizeSubjectKind(input.subjectKind);
  const actionType = normalizeActionType(input.actionType);
  const toolName = clampText(input.toolName, 120) || null;

  try {
    // The SUBJECT of the press — which reply, by whom, on which surface.
    //
    // The TENANT predicate is deliberately not folded in here: it is applied at the
    // statement below via `scopedToNullableTenant` (nullable, because a rating from a
    // signed-out surface has no tenant, and `tenant_id IS NULL` is the right filter
    // for that population — never "any tenant"). Keeping it at the statement is the
    // point: `check-tenant-scope` reads the statement, and so does the next person
    // to edit one.
    const subject = [
      eq(llmActionRatings.subjectKind, subjectKind),
      eq(llmActionRatings.subjectRef, subjectRef),
      eq(llmActionRatings.userId, ctx.userId),
    ];

    if (rating === 0) {
      await db
        .delete(llmActionRatings)
        .where(scopedToNullableTenant(llmActionRatings, ctx.tenantId ?? null, ...subject));
      await invalidateSummaries(env, ctx.tenantId);
      return { ok: true, rating: 0 };
    }

    const values = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      projectId: input.projectId ?? null,
      surface: normalizeSurface(input.surface),
      subjectKind,
      subjectRef,
      actionType,
      toolName,
      resolvedModel,
      plan: clampText(ctx.plan, 16) || 'free',
      rating,
      comment: clampText(input.comment, 2000) || null,
      updatedAt: new Date(),
    };

    const inserted = await db
      .insert(llmActionRatings)
      .values(values)
      .onConflictDoUpdate({
        target: [llmActionRatings.tenantId, llmActionRatings.subjectKind, llmActionRatings.subjectRef, llmActionRatings.userId],
        set: {
          rating: values.rating,
          resolvedModel: values.resolvedModel,
          actionType: values.actionType,
          toolName: values.toolName,
          comment: values.comment,
          updatedAt: values.updatedAt,
        },
      })
      .returning({ id: llmActionRatings.id });

    // The router learns from every press, including a flip — an up that becomes a
    // down IS new information. The fold is incremental (no table scan) and the
    // scheduled reconcile repairs any drift, so an over-count here is self-healing.
    if (inserted.length > 0) {
      await applyRatingToRoutingTable(env, db, {
        tenantId: ctx.tenantId,
        projectId: input.projectId ?? null,
        actionType,
        model: resolvedModel,
        up: rating === 1,
      });
    }
    await invalidateSummaries(env, ctx.tenantId);
    return { ok: true, rating };
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/actionRatings.ts', operation: 'recordActionRating' });
    return { ok: false, error: 'Failed to record rating' };
  }
}

/** Drop the tenant's rollup AND the platform rollup — a new press changes both. */
async function invalidateSummaries(env: Env, tenantId: number | null): Promise<void> {
  const windows = [RATING_SUMMARY_DAYS_DEFAULT, ROUTING_WINDOW_DAYS];
  await Promise.all(
    windows.flatMap((days) => [
      invalidateCached(env, summaryKey(null, days)),
      ...(tenantId == null ? [] : [invalidateCached(env, summaryKey(tenantId, days))]),
    ]),
  // Best-effort: a failed invalidation only means the rollup stays stale until its
  // TTL expires, which must never fail the rating that was successfully recorded.
  // Reported rather than swallowed — a KV that has stopped accepting deletes is a
  // real fault, and a rating surface that silently serves week-old numbers is how
  // it goes unnoticed.
  ).catch((error: unknown) => {
    reportCaughtError(error, {
      source: 'application/llm/actionRatings.ts',
      operation: 'invalidateSummaries',
    });
  });
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

/** Default reporting window for the admin summary. */
export const RATING_SUMMARY_DAYS_DEFAULT = 30;

export interface RatingSummary {
  /** Window in days the rollup covers. */
  days: number;
  totals: { up: number; down: number; total: number; score: number };
  /** Every (model × action × tool) bucket, best-first. */
  buckets: RatingBucket[];
  /** Per-action head-to-head verdicts, biggest margin first. */
  leaders: RatingLeader[];
  /** Distinct models that carry at least one rating in the window. */
  models: number;
}

/**
 * Aggregate ratings for a scope (a tenant, or the whole platform when
 * `tenantId` is null) in ONE grouped query, served read-through so the admin
 * panel does not re-scan on every render. Invalidated by {@link recordActionRating}.
 */
export async function summarizeActionRatings(
  env: Env,
  db: Db,
  opts: { tenantId?: number | null; days?: number } = {},
): Promise<RatingSummary> {
  const days = Math.min(Math.max(Math.floor(opts.days ?? RATING_SUMMARY_DAYS_DEFAULT), 1), 365);
  const tenantId = opts.tenantId ?? null;
  return getOrSetCached(
    env,
    summaryKey(tenantId, days),
    () => loadSummary(db, tenantId, days),
    { kvTtlSeconds: 300, l1TtlMs: 30_000 },
  );
}

async function loadSummary(db: Db, tenantId: number | null, days: number): Promise<RatingSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({
        model: llmActionRatings.resolvedModel,
        actionType: llmActionRatings.actionType,
        toolName: llmActionRatings.toolName,
        up: sql<number>`count(*) FILTER (WHERE ${llmActionRatings.rating} = 1)::int`,
        down: sql<number>`count(*) FILTER (WHERE ${llmActionRatings.rating} = -1)::int`,
      })
      .from(llmActionRatings)
      // No tenant ⇒ the PLATFORM rollup behind /api/admin/llm-ratings, which is
      // superadmin-gated before this is reached and returns nothing tenant-shaped:
      // a GROUP BY (model, action, tool) of counts. Declared, not baselined.
      .where(
        tenantId == null
          ? acrossTenants(llmActionRatings, 'platform_admin', gte(llmActionRatings.createdAt, since))
          : scopedToTenant(llmActionRatings, tenantId, gte(llmActionRatings.createdAt, since)),
      )
      .groupBy(llmActionRatings.resolvedModel, llmActionRatings.actionType, llmActionRatings.toolName)
      .orderBy(desc(sql`count(*)`));

    const buckets = summarizeRatingRows(rows);
    const up = buckets.reduce((a, b) => a + b.up, 0);
    const down = buckets.reduce((a, b) => a + b.down, 0);
    return {
      days,
      totals: { up, down, total: up + down, score: ratingScore(up, down) },
      buckets,
      leaders: ratingLeaders(buckets),
      models: new Set(buckets.map((b) => b.model)).size,
    };
  } catch (error) {
    reportCaughtError(error, { source: 'application/llm/actionRatings.ts', operation: 'summarizeActionRatings' });
    return { days, totals: { up: 0, down: 0, total: 0, score: ratingScore(0, 0) }, buckets: [], leaders: [], models: 0 };
  }
}
