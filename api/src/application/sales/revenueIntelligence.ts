/**
 * Who to sell to, and which record is which (PRD 19 §9).
 *
 * Three capabilities Builderforce had schema for and no reader:
 *
 *   `ri_icps`       the ideal-customer profile — criteria plus WEIGHTINGS, which
 *                   is what makes a score explainable rather than a verdict.
 *   `ri_prospects`  a company or person scored against an ICP, with the signals
 *                   that produced the score kept beside it.
 *   `ri_ids`        identity resolution: (source, source_id) -> canonical ref, so
 *                   the same company arriving from LinkedIn, Clearbit and a CSV
 *                   is one prospect rather than three.
 *   `deal_flow_opportunities`  inbound that arrived without a seller — a form, a
 *                   referral, a partner — scored and triaged before it becomes a deal.
 *
 * ── WHAT DELIBERATELY DID NOT COME ACROSS: `ri_sequences` ───────────────────
 * BurnRateOS's `revenueIntelligence` also owned a sequence table, and this module
 * does NOT give it a feature path. Builderforce already runs cadences, and it
 * runs them on a deliberately different design: the sequence is a CANVAS OBJECT
 * carrying steps and enrolments, and `sequenceRunner.ts` is a sweep over "who is
 * due" rather than a timer per person — an argument that module makes at length
 * and that has already been applied twice elsewhere in this schema. Two sequence
 * models would give the platform two answers to "what is about to be sent to this
 * person", which is the outcome §2 exists to prevent. `ri_sequences` is therefore
 * a `transform` target: its rows become sequence objects.
 *
 * ── SCORING IS EXPLAINED, NOT ASSERTED ──────────────────────────────────────
 * {@link scoreProspect} stores the per-criterion contributions in `signals`
 * alongside the total. A prospect score with no breakdown is a number a seller
 * cannot argue with and therefore cannot trust; a breakdown is also the only way
 * to notice that the whole score is coming from one criterion.
 *
 * ── IDENTITY RESOLUTION IS THE POINT OF `ri_ids` ────────────────────────────
 * `uq_ri_ids_source` is (tenant, source, source_id), so one external id maps to
 * exactly one canonical ref. {@link resolveIdentity} is upsert-on-that-key: a
 * second import of the same LinkedIn URL updates the mapping rather than creating
 * a rival one. The reverse read, {@link identitiesFor}, is what lets a merge
 * screen show every external id a canonical record has collected.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  dealFlowOpportunities,
  riIcps,
  riIds,
  riProspects,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';

/** `ri_prospects.status`. */
export const PROSPECT_STATUSES = ['new', 'enriched', 'sequenced', 'engaged', 'converted', 'disqualified'] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** `deal_flow_opportunities.status`. */
export const DEAL_FLOW_STATUSES = ['new', 'qualifying', 'converted', 'rejected'] as const;
export type DealFlowStatus = (typeof DEAL_FLOW_STATUSES)[number];

/** `ri_ids.entity_kind`. */
export const ENTITY_KINDS = ['person', 'company'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const isProspectStatus = (v: unknown): v is ProspectStatus =>
  typeof v === 'string' && (PROSPECT_STATUSES as readonly string[]).includes(v);
export const isDealFlowStatus = (v: unknown): v is DealFlowStatus =>
  typeof v === 'string' && (DEAL_FLOW_STATUSES as readonly string[]).includes(v);
export const isEntityKind = (v: unknown): v is EntityKind =>
  typeof v === 'string' && (ENTITY_KINDS as readonly string[]).includes(v);

export class RevenueIntelError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'RevenueIntelError';
  }
}

const dec = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : String(n);

// ── ICPs ────────────────────────────────────────────────────────────────────

export type IcpInput = {
  name: string;
  description?: string | null;
  /** `{ criterion: expectedValue }` — what a good fit looks like. */
  criteria: Record<string, unknown>;
  /** `{ criterion: weight }`. Missing weights count as 1. */
  weightings?: Record<string, number> | null;
};

export async function listIcps(db: Db, tenantId: number) {
  return db
    .select()
    .from(riIcps)
    .where(scopedToTenant(riIcps, tenantId))
    .orderBy(desc(riIcps.isDefault), desc(riIcps.updatedAt));
}

export async function createIcp(db: Db, tenantId: number, input: IcpInput) {
  const name = input.name.trim();
  if (!name) throw new RevenueIntelError('name is required');
  if (!input.criteria || Object.keys(input.criteria).length === 0) {
    throw new RevenueIntelError('an ICP with no criteria scores every prospect identically');
  }
  const [row] = await db
    .insert(riIcps)
    .values({
      tenantId,
      name: name.slice(0, 200),
      description: input.description ?? null,
      criteria: input.criteria,
      weightings: input.weightings ?? null,
    })
    .returning();
  if (!row) throw new RevenueIntelError('could not create the ICP');
  return row;
}

/** Exactly one default ICP, enforced by the writer — a prospect scored against
 *  "the" ICP must have one ICP to be scored against. */
export async function setDefaultIcp(db: Db, tenantId: number, id: number) {
  const row = await db.transaction(async (tx) => {
    await tx
      .update(riIcps)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(scopedToTenant(riIcps, tenantId, eq(riIcps.isDefault, true)));
    const [updated] = await tx
      .update(riIcps)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(scopedToTenant(riIcps, tenantId, eq(riIcps.id, id)))
      .returning();
    return updated;
  });
  if (!row) throw new RevenueIntelError('ICP not found', 404);
  return row;
}

// ── Prospects ───────────────────────────────────────────────────────────────

/**
 * Score a prospect against an ICP and record WHY.
 *
 * The scoring is deliberately simple and deliberately visible: each criterion the
 * observed attributes match contributes its weight, the total is normalised to
 * 0–100 against the maximum achievable, and every contribution is stored in
 * `signals`. An opaque score is one a seller ignores the third time it is wrong.
 *
 * Matching is equality on a normalised string, not fuzzy: "fintech" matching
 * "financial technology" is a product decision about a synonym table, and quietly
 * doing it inside a scorer is how a score becomes unexplainable.
 */
export async function scoreProspect(
  db: Db,
  tenantId: number,
  input: {
    icpId: number;
    contactRef?: string | null;
    companyRef?: string | null;
    attributes: Record<string, unknown>;
    ownerRef?: string | null;
  },
) {
  if (!input.contactRef && !input.companyRef) {
    throw new RevenueIntelError('a prospect needs a contactRef or a companyRef');
  }

  const [icp] = await db
    .select()
    .from(riIcps)
    .where(scopedToTenant(riIcps, tenantId, eq(riIcps.id, input.icpId)))
    .limit(1);
  if (!icp) throw new RevenueIntelError('ICP not found', 404);

  const criteria = (icp.criteria ?? {}) as Record<string, unknown>;
  const weights = (icp.weightings ?? {}) as Record<string, number>;

  const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();
  const contributions: { criterion: string; expected: unknown; observed: unknown; weight: number; matched: boolean }[] = [];
  let earned = 0;
  let possible = 0;

  for (const [criterion, expected] of Object.entries(criteria)) {
    const weight = Number.isFinite(weights[criterion]) ? Number(weights[criterion]) : 1;
    possible += weight;
    const observed = input.attributes[criterion];
    const matched = Array.isArray(expected)
      ? expected.some((e) => norm(e) === norm(observed))
      : norm(expected) === norm(observed);
    if (matched) earned += weight;
    contributions.push({ criterion, expected, observed: observed ?? null, weight, matched });
  }

  // Zero achievable weight would make every prospect a perfect fit; report 0 and
  // let the breakdown show that the ICP, not the prospect, is the problem.
  const score = possible > 0 ? (earned / possible) * 100 : 0;

  const [row] = await db
    .insert(riProspects)
    .values({
      tenantId,
      icpId: input.icpId,
      contactRef: input.contactRef ?? null,
      companyRef: input.companyRef ?? null,
      score: score.toFixed(2),
      signals: { contributions, earned, possible },
      status: 'new',
      ownerRef: input.ownerRef ?? null,
    })
    .returning();
  if (!row) throw new RevenueIntelError('could not score the prospect');
  return row;
}

/** The prospect queue — highest score first, optionally by status. */
export async function prospectQueue(db: Db, tenantId: number, status?: ProspectStatus) {
  if (status !== undefined && !isProspectStatus(status)) {
    throw new RevenueIntelError(`status must be one of: ${PROSPECT_STATUSES.join(', ')}`);
  }
  return db
    .select()
    .from(riProspects)
    .where(scopedToTenant(riProspects, tenantId, status ? eq(riProspects.status, status) : undefined))
    .orderBy(desc(riProspects.score));
}

export async function advanceProspect(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  status: ProspectStatus,
) {
  if (!isProspectStatus(status)) {
    throw new RevenueIntelError(`status must be one of: ${PROSPECT_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(riProspects)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(riProspects, tenantId, eq(riProspects.id, id)))
    .returning();
  if (!row) throw new RevenueIntelError('prospect not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'prospect.advanced',
    targetType: 'prospect', targetId: String(id),
    metadata: { status, score: row.score },
  });
  return row;
}

/**
 * Does the ICP actually predict conversion?
 *
 * Buckets prospects by score decile and reports the conversion rate in each. An
 * ICP whose top decile converts no better than its bottom one is not a profile,
 * it is a preference — and nothing else in this module can reveal that.
 */
export async function icpEffectiveness(db: Db, tenantId: number, icpId: number) {
  return db
    .select({
      decile: sql<number>`width_bucket(${riProspects.score}, 0, 100, 10)`,
      prospects: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where ${riProspects.status} = 'converted')::int`,
      disqualified: sql<number>`count(*) filter (where ${riProspects.status} = 'disqualified')::int`,
      conversionRate: sql<number>`(count(*) filter (where ${riProspects.status} = 'converted')::float8 / nullif(count(*), 0))`,
    })
    .from(riProspects)
    .where(scopedToTenant(riProspects, tenantId, and(
      eq(riProspects.icpId, icpId),
      sql`${riProspects.score} is not null`,
    )))
    .groupBy(sql`width_bucket(${riProspects.score}, 0, 100, 10)`)
    .orderBy(sql`width_bucket(${riProspects.score}, 0, 100, 10)`);
}

// ── Identity resolution ─────────────────────────────────────────────────────

/**
 * Map an external id to a canonical record.
 *
 * Upserts on (tenant, source, source_id), which is the unique index: importing
 * the same LinkedIn URL twice repoints the mapping rather than creating a rival.
 * `confidence` is carried because resolution is frequently a guess, and a merge
 * screen needs to show which links are safe to trust.
 */
export async function resolveIdentity(
  db: Db,
  tenantId: number,
  input: { entityKind: EntityKind; canonicalRef: string; source: string; sourceId: string; confidence?: number | null },
) {
  if (!isEntityKind(input.entityKind)) {
    throw new RevenueIntelError(`entityKind must be one of: ${ENTITY_KINDS.join(', ')}`);
  }
  const canonicalRef = input.canonicalRef.trim();
  const source = input.source.trim();
  const sourceId = input.sourceId.trim();
  if (!canonicalRef || !source || !sourceId) {
    throw new RevenueIntelError('canonicalRef, source and sourceId are all required');
  }

  const [row] = await db
    .insert(riIds)
    .values({
      tenantId,
      entityKind: input.entityKind,
      canonicalRef: canonicalRef.slice(0, 64),
      source: source.slice(0, 64),
      sourceId: sourceId.slice(0, 255),
      confidence: dec(input.confidence),
      resolvedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [riIds.tenantId, riIds.source, riIds.sourceId],
      set: {
        entityKind: input.entityKind,
        canonicalRef: canonicalRef.slice(0, 64),
        confidence: dec(input.confidence),
        resolvedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new RevenueIntelError('could not resolve the identity');
  return row;
}

/** Every external id this canonical record has collected — the merge screen. */
export async function identitiesFor(db: Db, tenantId: number, entityKind: EntityKind, canonicalRef: string) {
  return db
    .select()
    .from(riIds)
    .where(scopedToTenant(riIds, tenantId, and(
      eq(riIds.entityKind, entityKind),
      eq(riIds.canonicalRef, canonicalRef.trim()),
    )))
    .orderBy(desc(riIds.resolvedAt));
}

/** The canonical record behind an external id, or null. The lookup an importer
 *  does before deciding whether it is creating or updating. */
export async function canonicalFor(db: Db, tenantId: number, source: string, sourceId: string) {
  const [row] = await db
    .select({ entityKind: riIds.entityKind, canonicalRef: riIds.canonicalRef, confidence: riIds.confidence })
    .from(riIds)
    .where(scopedToTenant(riIds, tenantId, and(
      eq(riIds.source, source.trim()),
      eq(riIds.sourceId, sourceId.trim()),
    )))
    .limit(1);
  return row ?? null;
}

/**
 * External ids that point at more than one canonical record.
 *
 * The unique index makes this impossible per (source, source_id) — so what this
 * finds is the other direction: one canonical ref reachable from two ids of the
 * SAME source, which is the signature of a duplicate that slipped through and the
 * list a data-quality sweep should work from.
 */
export async function suspectedDuplicates(db: Db, tenantId: number) {
  return db
    .select({
      entityKind: riIds.entityKind,
      source: riIds.source,
      canonicalRef: riIds.canonicalRef,
      idCount: sql<number>`count(*)::int`,
    })
    .from(riIds)
    .where(scopedToTenant(riIds, tenantId))
    .groupBy(riIds.entityKind, riIds.source, riIds.canonicalRef)
    .having(sql`count(*) > 1`)
    .orderBy(desc(sql`count(*)`));
}

// ── Inbound deal flow ───────────────────────────────────────────────────────

/**
 * Inbound that arrived without a seller — a form, a referral, a partner.
 *
 * Separate from `ri_prospects` because the direction is opposite and so is the
 * evidence: a prospect is somebody WE picked and scored against a profile; deal
 * flow is somebody who picked US, and the only signal is what they said. Merging
 * them would make `source` meaningless on half the rows.
 */
export async function recordDealFlow(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  input: { source: string; companyName?: string | null; contactEmail?: string | null; summary?: string | null; estimatedValue?: number | null; currency?: string; score?: number | null },
) {
  const source = input.source.trim();
  if (!source) throw new RevenueIntelError('source is required — deal flow with no origin cannot be attributed');

  const [row] = await db
    .insert(dealFlowOpportunities)
    .values({
      tenantId,
      source: source.slice(0, 64),
      companyName: input.companyName ?? null,
      contactEmail: input.contactEmail ?? null,
      summary: input.summary ?? null,
      estimatedValue: dec(input.estimatedValue),
      currency: input.currency ?? 'USD',
      score: dec(input.score),
      status: 'new',
    })
    .returning();
  if (!row) throw new RevenueIntelError('could not record the opportunity');

  await recordActivity(env, db, {
    tenantId, actor, verb: 'deal_flow.received',
    targetType: 'deal_flow', targetId: String(row.id),
    metadata: { source, companyName: input.companyName ?? null, estimatedValue: input.estimatedValue ?? null },
  });
  return row;
}

export async function dealFlowQueue(db: Db, tenantId: number, status?: DealFlowStatus) {
  if (status !== undefined && !isDealFlowStatus(status)) {
    throw new RevenueIntelError(`status must be one of: ${DEAL_FLOW_STATUSES.join(', ')}`);
  }
  return db
    .select()
    .from(dealFlowOpportunities)
    .where(scopedToTenant(dealFlowOpportunities, tenantId, status ? eq(dealFlowOpportunities.status, status) : undefined))
    .orderBy(desc(dealFlowOpportunities.score), desc(dealFlowOpportunities.createdAt));
}

export async function triageDealFlow(
  db: Db,
  env: Env,
  tenantId: number,
  actor: ActorIdentity,
  id: number,
  status: DealFlowStatus,
) {
  if (!isDealFlowStatus(status)) {
    throw new RevenueIntelError(`status must be one of: ${DEAL_FLOW_STATUSES.join(', ')}`);
  }
  const [row] = await db
    .update(dealFlowOpportunities)
    .set({ status, updatedAt: new Date() })
    .where(scopedToTenant(dealFlowOpportunities, tenantId, eq(dealFlowOpportunities.id, id)))
    .returning();
  if (!row) throw new RevenueIntelError('opportunity not found', 404);

  await recordActivity(env, db, {
    tenantId, actor, verb: 'deal_flow.triaged',
    targetType: 'deal_flow', targetId: String(id),
    metadata: { status, source: row.source },
  });
  return row;
}

/** Which inbound sources are worth the effort — count, conversion and value by
 *  source. The read that decides where a partner budget goes. */
export async function dealFlowBySource(db: Db, tenantId: number) {
  return db
    .select({
      source: dealFlowOpportunities.source,
      total: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where ${dealFlowOpportunities.status} = 'converted')::int`,
      rejected: sql<number>`count(*) filter (where ${dealFlowOpportunities.status} = 'rejected')::int`,
      pipelineValue: sql<number>`coalesce(sum(${dealFlowOpportunities.estimatedValue}) filter (
        where ${dealFlowOpportunities.status} in ('new','qualifying')
      ), 0)::float8`,
      wonValue: sql<number>`coalesce(sum(${dealFlowOpportunities.estimatedValue}) filter (
        where ${dealFlowOpportunities.status} = 'converted'
      ), 0)::float8`,
    })
    .from(dealFlowOpportunities)
    .where(scopedToTenant(dealFlowOpportunities, tenantId))
    .groupBy(dealFlowOpportunities.source)
    .orderBy(desc(sql`count(*)`));
}

/** Prospects a set of canonical refs already has — used before scoring an import
 *  so the same company is not queued twice. */
export async function existingProspectRefs(db: Db, tenantId: number, companyRefs: string[]) {
  if (companyRefs.length === 0) return [];
  return db
    .select({ companyRef: riProspects.companyRef })
    .from(riProspects)
    .where(scopedToTenant(riProspects, tenantId, inArray(riProspects.companyRef, companyRefs)));
}
