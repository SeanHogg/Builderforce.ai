/**
 * ONE pipeline with one number — the canvas board as a PROJECTION of the CRM.
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
 * The board becomes DERIVED. `project()` reads the deals and their stages and
 * returns the exact shape `readPipelineModel` already consumes, so the card
 * renders unchanged and its contents are no longer authored. Nothing has to
 * remember to mirror, because there is nothing to mirror INTO — the object is
 * overwritten from the source every time it is read.
 *
 * And the write goes the other way for the same reason: {@link moveDeal} changes
 * the DEAL and hands back the freshly projected board in the same call. A move
 * cannot leave the two out of step, because there is no second write to forget.
 *
 * ── WHY THE STAGES COME FROM THE TENANT AND NOT FROM A CONSTANT ──────────────
 * `pipeline_stages` exists precisely because "every tenant renames these and
 * reports on the renames". The canvas's `DEFAULT_PIPELINE_STAGES` is the fallback
 * for a tenant that has declared none — it is what the board draws before the CRM
 * has an opinion, not a second opinion competing with it.
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deals, pipelineStages, pipelineTouchpoints } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

export class PipelineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PipelineError';
  }
}

/**
 * The fallback ladder — the SAME seven the canvas and `salesRoutes` both know.
 *
 * Duplicated here rather than imported from the frontend for the obvious layering
 * reason, and held to the frontend's list by `pipelineProjection.test.ts`, which
 * asserts the two are identical. A silent divergence would mean a card dropped in
 * a stage the API refuses.
 */
export const FALLBACK_STAGES = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'] as const;

/** The board is a view, not an export. Beyond this a pipeline is a report. */
const MAX_DEALS = 400;

/** `deals.kind` values this projection covers. A recruiter placement fee and an
 *  investor allocation ride the same table by design (PRD 20 §3.3) and are NOT a
 *  sales pipeline — projecting them onto a sales board would inflate the one
 *  number the board exists to show. */
const SALES_KINDS = ['sales', 'renewal', 'expansion', 'partner'];

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
}

export interface ProjectedPipeline {
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

/**
 * Read the board.
 *
 * Three queries and no N+1: the stages, the deals, and the most recent touch per
 * deal in ONE grouped read rather than one per card. A pipeline is the surface
 * most likely to be opened with two hundred rows on it, and a per-card query is
 * the anti-pattern that only shows up in production.
 */
export async function project(
  db: Db,
  tenantId: number,
  options: { pipelineRef?: string | null; laneBy?: 'source' | 'owner' | 'none' } = {},
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
        expectedCloseAt: deals.expectedCloseAt,
      })
      .from(deals)
      .where(scopedToTenant(
        deals,
        tenantId,
        inArray(deals.kind, SALES_KINDS),
        pipelineRef ? eq(deals.pipelineRef, pipelineRef) : undefined,
      ))
      .orderBy(desc(deals.updatedAt))
      .limit(MAX_DEALS),
  ]);

  const stages = stageRows.length ? stageRows.map((row) => row.key) : [...FALLBACK_STAGES];

  // A lane is a SEGMENT, and the tenant's own answer to "what segments this" is
  // whichever of source/owner they actually populate. `none` is one unnamed lane,
  // which is the honest rendering of a pipeline nobody has segmented — not an
  // empty board, which reads as broken.
  const laneBy = options.laneBy ?? 'source';
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
        .limit(MAX_DEALS * 2)
    : [];

  // Newest-first order means the FIRST row seen per deal is its latest touch.
  const lastTouch = new Map<number, string>();
  for (const touch of touches) {
    if (touch.dealId != null && !lastTouch.has(touch.dealId) && touch.summary) {
      lastTouch.set(touch.dealId, touch.summary.slice(0, 240));
    }
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
    };
  });

  const open = dealRows.filter((row) => row.outcome === 'open');
  const won = dealRows.filter((row) => row.outcome === 'won');
  const sum = (rows: typeof dealRows) => rows.reduce((total, row) => total + (cents(row.amount) ?? 0), 0);

  return {
    pipelineRef,
    stages,
    lanes,
    cards,
    syncedAt: new Date().toISOString(),
    totals: { open: open.length, openValueCents: sum(open), won: won.length, wonValueCents: sum(won) },
  };
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
  options: { pipelineRef?: string | null; laneBy?: 'source' | 'owner' | 'none' } = {},
): Promise<ProjectedPipeline> {
  const [deal] = await db
    .select({ id: deals.id, pipelineRef: deals.pipelineRef, stage: deals.stage })
    .from(deals)
    .where(scopedToTenant(deals, tenantId, eq(deals.id, dealId)))
    .limit(1);
  if (!deal) throw new PipelineError('No deal with that id in this workspace.', 404);

  const declared = await db
    .select({ key: pipelineStages.key, outcome: pipelineStages.outcome })
    .from(pipelineStages)
    .where(scopedToTenant(
      pipelineStages,
      tenantId,
      deal.pipelineRef ? eq(pipelineStages.pipelineRef, deal.pipelineRef) : undefined,
    ));

  const known = declared.length ? declared : FALLBACK_STAGES.map((key) => ({
    key,
    // The fallback ladder's own semantics, stated once: only the last two are
    // terminal, and everything before them is open.
    outcome: key === 'won' ? 'won' : key === 'lost' ? 'lost' : 'open',
  }));

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

  return project(db, tenantId, { pipelineRef: deal.pipelineRef, ...options });
}
