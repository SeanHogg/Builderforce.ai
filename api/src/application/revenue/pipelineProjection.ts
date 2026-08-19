/**
 * ONE pipeline with one number — a board as a PROJECTION of the CRM.
 *
 * ── THE DEFECT THIS REMOVES ──────────────────────────────────────────────────
 * `lib/canvasSalesPipeline.ts` normalises authored JSON: `cards` with a title and
 * a `valueCents`, held in memory on a canvas object. The `revenue` domain owns
 * `deals`, `pipeline_stages`, `pipeline_touchpoints`, contacts, sequences and
 * enrichment provenance. Two systems of record for one question.
 *
 * The bridge between them was a PROMPT INSTRUCTION — "after a successful sales
 * mutation, mirror the returned canonical id and current values into the matching
 * salesContact, salesCampaign, salesGoal, or salesPipeline canvas object". That
 * is a synchronisation protocol whose only enforcement is a language model
 * remembering a paragraph, and it fails in the direction nobody notices: the
 * board keeps showing the number it was last told, the CRM has moved, and the two
 * disagree silently until somebody forecasts off the wrong one.
 *
 * ── THE FIX IS A DIRECTION, NOT A BETTER PROMPT ──────────────────────────────
 * The board becomes DERIVED. {@link project} reads the deals and their stages and
 * returns the exact shape `readPipelineModel` already consumes, so the card
 * renders unchanged and its contents are no longer authored. Nothing has to
 * remember to mirror, because there is nothing to mirror INTO — the object is
 * overwritten from the source every time it is read.
 *
 * And the write goes the other way for the same reason: {@link moveDeal} changes
 * the DEAL and hands back the freshly projected board in the same call. A move
 * cannot leave the two out of step, because there is no second write to forget.
 *
 * ── THE RAISE IS THE SAME BOARD (FO-E1) ──────────────────────────────────────
 * `fundingRound.investors` was a rows table — `{investor, stage, amount, nextStep}`
 * — with no investor as an object, no warm-intro path and no per-investor thread.
 * All three already existed one layer down: `deals.kind = 'investment'` is the
 * allocation PRD 20 §3.3 named, `party_roles role='investor'` is the firm, and
 * `pipeline_touchpoints` is the thread. So a fundraise pipeline is not a second
 * engine — it is this one, read through a different {@link PipelineFamily}. The
 * families are DATA (`pipelineFamilies.ts`); nothing in this file branches on which
 * board it is drawing.
 *
 * ── WHY THE STAGES COME FROM THE TENANT AND NOT FROM A CONSTANT ──────────────
 * `pipeline_stages` exists precisely because "every tenant renames these and
 * reports on the renames". A family's ladder is the fallback for a tenant that has
 * declared none — it is what the board draws before the CRM has an opinion, not a
 * second opinion competing with it.
 */

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { partyRef as toPartyRef } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { deals, partyRoles, pipelineStages, pipelineTouchpoints } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  PIPELINE_FAMILIES,
  familyForDealKind,
  fallbackOutcome,
  pipelineFamily,
  type LaneBy,
  type PipelineFamily,
  type PipelineFamilyKey,
} from './pipelineFamilies';

export class PipelineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PipelineError';
  }
}

/**
 * The SALES fallback ladder, re-exported under the name the contract test knows.
 *
 * Held to the frontend's `DEFAULT_PIPELINE_STAGES` by `pipelineProjection.test.ts`,
 * which reads the other file off disk — a silent divergence would mean a card
 * dropped in a stage the API refuses.
 */
export const FALLBACK_STAGES = PIPELINE_FAMILIES.sales.fallbackStages;

/** The board is a view, not an export. Beyond this a pipeline is a report. */
const MAX_DEALS = 400;

/** How many entries of one deal's thread a read returns. A conversation with a
 *  firm that has run longer than this is a relationship, and the deal record is
 *  where it is read from in full — not a card. */
const MAX_THREAD_ENTRIES = 50;

export interface ProjectedCard {
  id: string;
  /** The canonical deal id. This is the whole point: a card on the board is a
   *  handle on a row, not a copy of one. */
  dealId: number;
  lane: string;
  stage: string;
  title: string;
  note: string;
  valueCents: number | null;
  /** The counterparty's `party_roles.party_ref` — the customer on a sales deal,
   *  the FIRM on an allocation. What makes an investor an object rather than a
   *  typed name in a spreadsheet cell (FO-A1, FO-E1). */
  partyRef: string | null;
  /**
   * Who can make the introduction, when this was not a cold approach.
   *
   * On `deals.attrs.introVia` rather than its own column: a warm intro is a fact
   * about ONE deal's origin, not a standing property of the firm — the same
   * partner introduces you once and is not "the intro path" forever.
   */
  warmIntro: string | null;
  /** The human's own judgement, 0-100, when somebody made one. Null means the
   *  STAGE decides — the split the canvas model already draws. */
  probabilityPercent: number | null;
  /** How many touches this deal has. A firm with a stage and no thread is a name
   *  somebody typed; the count is what makes that visible on the board. */
  touchCount: number;
}

export interface ProjectedPipeline {
  family: PipelineFamilyKey;
  pipelineRef: string | null;
  stages: string[];
  lanes: Array<{ id: string; title: string; hint: string }>;
  cards: ProjectedCard[];
  /** When this was read. Rendered as staleness, so a board nobody has refreshed
   *  says so rather than looking current. */
  syncedAt: string;
  /** Totals computed HERE, from the same rows the cards came from, so the header
   *  cannot disagree with what is under it. */
  totals: { open: number; openValueCents: number; won: number; wonValueCents: number };
}

const cents = (amount: string | null): number | null => {
  if (amount == null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

const percent = (value: string | null): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
};

const attrText = (attrs: unknown, key: string): string | null => {
  const row = attrs && typeof attrs === 'object' && !Array.isArray(attrs) ? attrs as Record<string, unknown> : null;
  const value = row?.[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
};

interface ProjectOptions {
  family?: unknown;
  pipelineRef?: string | null;
  laneBy?: LaneBy;
}

/**
 * Read the board.
 *
 * Three queries and no N+1: the stages, the deals, and every touch for those deals
 * in ONE grouped read rather than one per card. A pipeline is the surface most
 * likely to be opened with two hundred rows on it, and a per-card query is the
 * anti-pattern that only shows up in production.
 */
export async function project(db: Db, tenantId: number, options: ProjectOptions = {}): Promise<ProjectedPipeline> {
  return projectFamily(db, tenantId, pipelineFamily(options.family), options);
}

async function projectFamily(
  db: Db,
  tenantId: number,
  family: PipelineFamily,
  options: ProjectOptions,
): Promise<ProjectedPipeline> {
  const pipelineRef = options.pipelineRef?.trim() || null;

  const [stageRows, dealRows] = await Promise.all([
    db
      .select({ key: pipelineStages.key, label: pipelineStages.label, position: pipelineStages.position })
      .from(pipelineStages)
      .where(scopedToTenant(
        pipelineStages,
        tenantId,
        pipelineRef ? eq(pipelineStages.pipelineRef, pipelineRef) : undefined,
      ))
      .orderBy(asc(pipelineStages.position)),
    db
      .select({
        id: deals.id,
        name: deals.name,
        stage: deals.stage,
        amount: deals.amount,
        outcome: deals.outcome,
        source: deals.source,
        ownerRef: deals.ownerRef,
        accountRef: deals.accountRef,
        probability: deals.probability,
        attrs: deals.attrs,
        expectedCloseAt: deals.expectedCloseAt,
      })
      .from(deals)
      .where(scopedToTenant(
        deals,
        tenantId,
        inArray(deals.kind, [...family.kinds]),
        pipelineRef ? eq(deals.pipelineRef, pipelineRef) : undefined,
      ))
      .orderBy(desc(deals.updatedAt))
      .limit(MAX_DEALS),
  ]);

  const stages = stageRows.length ? stageRows.map((row) => row.key) : [...family.fallbackStages];

  // A lane is a SEGMENT, and the tenant's own answer to "what segments this" is
  // whichever of source/owner they actually populate. `none` is one unnamed lane,
  // which is the honest rendering of a pipeline nobody has segmented — not an
  // empty board, which reads as broken.
  const laneBy = options.laneBy ?? family.defaultLaneBy;
  const laneKey = (row: { source: string | null; ownerRef: string | null }): string =>
    laneBy === 'owner' ? (row.ownerRef ?? '') : laneBy === 'source' ? (row.source ?? '') : '';

  const laneIds = [...new Set(dealRows.map(laneKey))].filter(Boolean).slice(0, 8);
  const lanes = laneIds.length
    ? laneIds.map((id) => ({ id, title: id, hint: '' }))
    : [{ id: 'all', title: '', hint: '' }];

  const touches = dealRows.length
    ? await db
        .select({ dealId: pipelineTouchpoints.dealId, summary: pipelineTouchpoints.summary, occurredAt: pipelineTouchpoints.occurredAt })
        .from(pipelineTouchpoints)
        .where(scopedToTenant(pipelineTouchpoints, tenantId, inArray(pipelineTouchpoints.dealId, dealRows.map((d) => d.id))))
        .orderBy(desc(pipelineTouchpoints.occurredAt))
        .limit(MAX_DEALS * 4)
    : [];

  // Newest-first order means the FIRST row seen per deal is its latest touch.
  const lastTouch = new Map<number, string>();
  const touchCount = new Map<number, number>();
  for (const touch of touches) {
    if (touch.dealId == null) continue;
    touchCount.set(touch.dealId, (touchCount.get(touch.dealId) ?? 0) + 1);
    if (!lastTouch.has(touch.dealId) && touch.summary) lastTouch.set(touch.dealId, touch.summary.slice(0, 240));
  }

  const cards: ProjectedCard[] = dealRows.map((row) => {
    const lane = laneKey(row);
    return {
      id: `deal-${row.id}`,
      dealId: row.id,
      lane: laneIds.includes(lane) ? lane : lanes[0]!.id,
      // A deal whose stage the tenant has since renamed away lands in the first
      // stage rather than vanishing — an unplaced deal you cannot see is worse
      // than one in the wrong column, which is the rule `cardsAt` already applies
      // to lanes.
      stage: stages.includes(row.stage) ? row.stage : stages[0]!,
      title: row.name,
      note: lastTouch.get(row.id)
        ?? (row.expectedCloseAt ? `Expected ${row.expectedCloseAt.toISOString().slice(0, 10)}` : ''),
      valueCents: cents(row.amount),
      partyRef: row.accountRef,
      warmIntro: attrText(row.attrs, 'introVia'),
      probabilityPercent: percent(row.probability),
      touchCount: touchCount.get(row.id) ?? 0,
    };
  });

  const open = dealRows.filter((row) => row.outcome === 'open');
  const won = dealRows.filter((row) => row.outcome === 'won');
  const sum = (rows: typeof dealRows) => rows.reduce((total, row) => total + (cents(row.amount) ?? 0), 0);

  return {
    family: family.key,
    pipelineRef,
    stages,
    lanes,
    cards,
    syncedAt: new Date().toISOString(),
    totals: { open: open.length, openValueCents: sum(open), won: won.length, wonValueCents: sum(won) },
  };
}

/**
 * The family a deal belongs to, and the deal row, or a 404/409 explaining which.
 *
 * Shared by every write below so "which board is this on" is answered once, from
 * the deal's own `kind`, rather than trusted from a caller that could name the
 * wrong one.
 */
async function loadDeal(db: Db, tenantId: number, dealId: number) {
  if (!Number.isFinite(dealId)) throw new PipelineError('Pass the numeric deal id.', 400);
  const [deal] = await db
    .select({ id: deals.id, kind: deals.kind, pipelineRef: deals.pipelineRef, stage: deals.stage, name: deals.name })
    .from(deals)
    .where(scopedToTenant(deals, tenantId, eq(deals.id, dealId)))
    .limit(1);
  if (!deal) throw new PipelineError('No deal with that id in this workspace.', 404);
  const family = familyForDealKind(deal.kind);
  if (!family) {
    throw new PipelineError(`A "${deal.kind}" deal is not on a pipeline board — it rides the deals table by design and has no projection yet.`, 409);
  }
  return { deal, family };
}

/**
 * Move a deal, and hand back the board it belongs to.
 *
 * ONE call, because the failure this whole module exists to remove is the second
 * write somebody forgets. The stage is validated against the tenant's OWN stages,
 * so a board that is out of date cannot push a deal into a column the CRM
 * retired.
 *
 * `outcome` moves with the stage rather than being set separately: `deals`
 * carries both, and the table's own note says why they are distinct — `stage` is
 * what every tenant renames, `outcome` is what a report means by won. Deriving
 * one from the other HERE, from `pipeline_stages.outcome`, is what stops a deal
 * sitting in a column called "Closed Won" while every report counts it as open.
 */
export async function moveDeal(
  db: Db,
  tenantId: number,
  dealId: number,
  stage: string,
  options: { laneBy?: LaneBy } = {},
): Promise<ProjectedPipeline> {
  const { deal, family } = await loadDeal(db, tenantId, dealId);

  const declared = await db
    .select({ key: pipelineStages.key, outcome: pipelineStages.outcome })
    .from(pipelineStages)
    .where(scopedToTenant(
      pipelineStages,
      tenantId,
      deal.pipelineRef ? eq(pipelineStages.pipelineRef, deal.pipelineRef) : undefined,
    ));

  const known = declared.length
    ? declared
    : family.fallbackStages.map((key) => ({ key, outcome: fallbackOutcome(family, key) }));

  const target = known.find((row) => row.key === stage);
  if (!target) {
    throw new PipelineError(`"${stage}" is not a stage in this pipeline. Its stages are: ${known.map((s) => s.key).join(', ')}.`, 400);
  }

  const now = new Date();
  await db
    .update(deals)
    .set({
      stage: target.key,
      outcome: target.outcome,
      // A deal that just landed in a terminal stage closed now; one that moved
      // back out of one is open again and must not keep a close date, or the
      // "when did we win it" answer survives the win being undone.
      closedAt: target.outcome === 'open' ? null : now,
      updatedAt: now,
    })
    .where(scopedToTenant(deals, tenantId, eq(deals.id, dealId)));

  // The move IS a touch. Recorded here rather than left to the caller because a
  // stage change with no timeline entry is exactly the history a rep needs when
  // asked why a deal slipped — and `pipeline_touchpoints` is the editable
  // timeline that exists for it.
  await db.insert(pipelineTouchpoints).values({
    tenantId,
    dealId,
    channel: 'note',
    direction: 'internal',
    summary: `Stage ${deal.stage} → ${target.key}`,
    occurredAt: now,
  });

  return projectFamily(db, tenantId, family, { pipelineRef: deal.pipelineRef, ...options });
}

// ---------------------------------------------------------------------------
// The per-counterparty THREAD (FO-E1)
// ---------------------------------------------------------------------------

/** The channels a touch can be logged on. `intro` is what makes a warm path a
 *  recorded event rather than a note somebody typed — see {@link openDeal}. */
export const TOUCH_CHANNELS = ['call', 'email', 'meeting', 'demo', 'intro', 'note'] as const;
export type TouchChannel = typeof TOUCH_CHANNELS[number];

export const TOUCH_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const;

export interface ThreadEntry {
  id: number;
  dealId: number;
  channel: string;
  direction: string;
  summary: string;
  contactRef: string | null;
  occurredAt: string;
}

/** One deal's conversation, newest first. */
export async function dealThread(db: Db, tenantId: number, dealId: number): Promise<ThreadEntry[]> {
  await loadDeal(db, tenantId, dealId);
  const rows = await db
    .select({
      id: pipelineTouchpoints.id,
      dealId: pipelineTouchpoints.dealId,
      channel: pipelineTouchpoints.channel,
      direction: pipelineTouchpoints.direction,
      summary: pipelineTouchpoints.summary,
      contactRef: pipelineTouchpoints.contactRef,
      occurredAt: pipelineTouchpoints.occurredAt,
    })
    .from(pipelineTouchpoints)
    .where(scopedToTenant(pipelineTouchpoints, tenantId, eq(pipelineTouchpoints.dealId, dealId)))
    .orderBy(desc(pipelineTouchpoints.occurredAt))
    .limit(MAX_THREAD_ENTRIES);

  return rows.map((row) => ({
    id: row.id,
    dealId,
    channel: row.channel,
    direction: row.direction,
    summary: row.summary ?? '',
    contactRef: row.contactRef,
    occurredAt: (row.occurredAt ?? new Date()).toISOString(),
  }));
}

export interface LogTouchInput {
  channel?: string;
  direction?: string;
  summary: string;
  contactRef?: string | null;
  occurredAt?: string | null;
}

/**
 * Log a touch, and hand back the thread.
 *
 * Same one-call shape as {@link moveDeal} and for the same reason: the caller
 * renders what it just wrote from the response, so a board cannot be showing a
 * conversation that is one entry behind the record.
 *
 * `deals.updatedAt` moves with it, because "what have I not touched in a month"
 * is the question a pipeline is actually read for and a touch that left the deal
 * looking stale would answer it wrongly.
 */
export async function logDealTouch(db: Db, tenantId: number, dealId: number, input: LogTouchInput): Promise<ThreadEntry[]> {
  await loadDeal(db, tenantId, dealId);
  const summary = input.summary?.trim();
  if (!summary) throw new PipelineError('Say what happened — a touch with no summary is a timestamp nobody can act on.', 400);

  const channel = (TOUCH_CHANNELS as readonly string[]).includes(String(input.channel)) ? String(input.channel) : 'note';
  const direction = (TOUCH_DIRECTIONS as readonly string[]).includes(String(input.direction)) ? String(input.direction) : 'outbound';
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new PipelineError('occurredAt is not a date.', 400);

  await db.insert(pipelineTouchpoints).values({
    tenantId,
    dealId,
    channel,
    direction,
    summary: summary.slice(0, 2000),
    contactRef: input.contactRef?.trim() || null,
    occurredAt,
  });
  await db
    .update(deals)
    .set({ updatedAt: new Date() })
    .where(scopedToTenant(deals, tenantId, eq(deals.id, dealId)));

  return dealThread(db, tenantId, dealId);
}

// ---------------------------------------------------------------------------
// Opening a deal — the counterparty becomes an OBJECT (FO-A1 + FO-E1)
// ---------------------------------------------------------------------------

export interface OpenDealInput {
  family?: unknown;
  /** The counterparty's display name — "Northwind Ventures". The `party_ref` is
   *  DERIVED from it by the one shared slug function, never invented per caller. */
  counterparty: string;
  /** What the deal is called. Defaults to the counterparty, which is what a raise
   *  pipeline row actually is. */
  name?: string | null;
  /** Money, in the deal's own currency, as a plain number. */
  amount?: number | null;
  currency?: string | null;
  stage?: string | null;
  pipelineRef?: string | null;
  ownerRef?: string | null;
  source?: string | null;
  /** Who can make the introduction. Recorded on the deal AND logged as an `intro`
   *  touch, so the warm path is an event in the thread rather than a field nobody
   *  reads. */
  introVia?: string | null;
  expectedCloseAt?: string | null;
}

export interface OpenedDeal {
  dealId: number;
  partyRef: string;
  created: boolean;
  pipeline: ProjectedPipeline;
}

/**
 * Open a deal against a counterparty, creating the counterparty when it is new.
 *
 * The `party_roles` row is what makes an investor an OBJECT: FO-E1's whole
 * complaint about `fundingRound.investors` was that a firm was a string in a cell,
 * so every board that mentioned it mentioned a different spelling. One row per
 * (tenant, kind, ref, role) already existed; this writes into it rather than
 * beside it, and `onConflictDoNothing` means re-opening a second allocation with
 * the same firm does not reset anything the first one recorded.
 *
 * Idempotent on the DEAL too: one open deal per (counterparty, pipeline) in a
 * family. A founder who asks twice gets the same row back rather than two cards
 * for one conversation.
 */
export async function openDeal(db: Db, tenantId: number, input: OpenDealInput): Promise<OpenedDeal> {
  const family = pipelineFamily(input.family);
  const counterparty = input.counterparty?.trim();
  if (!counterparty) throw new PipelineError('Name the counterparty. A pipeline row with no party is a reminder, not a deal.', 400);

  const partyRef = toPartyRef(counterparty);
  if (!partyRef) throw new PipelineError('That name does not reduce to a usable reference — use the legal or trading name.', 400);

  const pipelineRef = input.pipelineRef?.trim() || null;
  const stage = input.stage?.trim() || family.fallbackStages[0]!;
  const declared = await db
    .select({ key: pipelineStages.key })
    .from(pipelineStages)
    .where(scopedToTenant(pipelineStages, tenantId, pipelineRef ? eq(pipelineStages.pipelineRef, pipelineRef) : undefined));
  const known = declared.length ? declared.map((row) => row.key) : [...family.fallbackStages];
  if (!known.includes(stage)) {
    throw new PipelineError(`"${stage}" is not a stage in this pipeline. Its stages are: ${known.join(', ')}.`, 400);
  }

  await db.insert(partyRoles)
    .values({
      tenantId,
      partyKind: 'company',
      partyRef,
      role: family.partyRole,
      status: 'active',
      startedAt: sql`now()`,
      attrs: { name: counterparty },
    })
    // A counterparty you have already met keeps the record it already has —
    // re-opening a deal is not a new relationship.
    .onConflictDoNothing({ target: [partyRoles.tenantId, partyRoles.partyKind, partyRoles.partyRef, partyRoles.role] });

  const [existing] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(scopedToTenant(
      deals,
      tenantId,
      inArray(deals.kind, [...family.kinds]),
      eq(deals.accountRef, partyRef),
      eq(deals.outcome, 'open'),
      pipelineRef ? eq(deals.pipelineRef, pipelineRef) : undefined,
    ))
    .limit(1);

  const attrs = input.introVia?.trim() ? { introVia: input.introVia.trim().slice(0, 200) } : null;
  const expectedCloseAt = input.expectedCloseAt ? new Date(input.expectedCloseAt) : null;
  if (expectedCloseAt && Number.isNaN(expectedCloseAt.getTime())) throw new PipelineError('expectedCloseAt is not a date.', 400);

  let dealId = existing?.id ?? 0;
  if (existing) {
    await db
      .update(deals)
      .set({
        ...(input.amount != null ? { amount: String(input.amount) } : {}),
        ...(attrs ? { attrs } : {}),
        ...(expectedCloseAt ? { expectedCloseAt } : {}),
        ...(input.ownerRef?.trim() ? { ownerRef: input.ownerRef.trim() } : {}),
        updatedAt: new Date(),
      })
      .where(scopedToTenant(deals, tenantId, eq(deals.id, existing.id)));
  } else {
    const [row] = await db
      .insert(deals)
      .values({
        tenantId,
        kind: family.kinds[0]!,
        name: (input.name?.trim() || counterparty).slice(0, 300),
        pipelineRef,
        stage,
        accountRef: partyRef,
        ownerRef: input.ownerRef?.trim() || null,
        amount: input.amount != null ? String(input.amount) : null,
        currency: input.currency?.trim() || 'USD',
        source: input.source?.trim() || null,
        expectedCloseAt,
        attrs,
      })
      .returning({ id: deals.id });
    if (!row) throw new PipelineError('The deal could not be created.', 500);
    dealId = row.id;
  }

  // The warm path as an EVENT. A field alone answers "who introduced us"; the
  // thread answers "and when, and what came of it", which is the half a founder
  // actually chases.
  if (input.introVia?.trim()) {
    await db.insert(pipelineTouchpoints).values({
      tenantId,
      dealId,
      channel: 'intro',
      direction: 'inbound',
      summary: `Warm introduction via ${input.introVia.trim().slice(0, 160)}`,
      occurredAt: new Date(),
    });
  }

  return {
    dealId,
    partyRef,
    created: !existing,
    pipeline: await projectFamily(db, tenantId, family, { pipelineRef }),
  };
}
