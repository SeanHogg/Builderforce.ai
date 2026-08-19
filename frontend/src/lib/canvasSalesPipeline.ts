/**
 * The sales-pipeline object's KANBAN model — what a `salesPipeline` card IS.
 *
 * ── THE DEFECT THIS REMOVES ──────────────────────────────────────────────────
 * `salesPipeline` had no renderer. It fell through to the generic card, so the
 * object at the centre of a sales associate's board — the one thing they open
 * the canvas to look at — drew a title, a status pill and nothing else. The
 * seven stages it carried in `data.stages` were never shown, and there was
 * nowhere to put a deal.
 *
 * It is now a KANBAN: stages across (columns), segments down (swimlanes), a card
 * at the intersection. Two axes rather than one because that is what a pipeline
 * actually is — "qualified" means a different conversation for a founder buying
 * on the demo and for an enterprise buyer with a security review, and a single
 * column of both is a list you cannot act on.
 *
 * Same contract as `canvasDashboard`: a pure normaliser over authored JSON, so a
 * board saved before this renders (the stages fold in, the lanes default to one),
 * and a model authoring `canvas_add_object` cannot produce a shape the card
 * cannot draw. Nothing here touches React or the network.
 */

/** Beyond this a lane is a wall of cards nobody reads; the rest are counted. */
export const PIPELINE_MAX_CARDS_PER_CELL = 6;
/** A pipeline with more lanes than this is a spreadsheet, not a board. */
export const PIPELINE_MAX_LANES = 8;
export const PIPELINE_MAX_STAGES = 10;

/** The default stages — the SAME seven `salesRoutes` validates, so a card moved
 *  on the board is a stage the API will accept. */
export const DEFAULT_PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'] as const;

export interface PipelineLane {
  id: string;
  title: string;
  /** One line of "what selling to this segment is like". Optional by design —
   *  a lane an associate added themselves has no coaching note. */
  hint: string;
}

export interface PipelineCard {
  id: string;
  /**
   * The canonical `deals.id` this card is a handle on, when the board was
   * PROJECTED rather than authored.
   *
   * Null on a hand-authored card, and that null is load-bearing: it is exactly the
   * difference between a card that can be dragged (the move writes the deal and the
   * board comes back from the same response) and one that cannot, because there is
   * no row behind it to move. The projection has always written it onto the object
   * — this model simply dropped it, which is why FO-F1 could say "each card carries
   * its dealId" and the renderer still had nothing to drag with.
   */
  dealId: number | null;
  lane: string;
  stage: string;
  title: string;
  note: string;
  /** Deal size in cents, when known. Null renders no figure rather than "$0",
   *  which would read as a worthless deal instead of an unpriced one. */
  valueCents: number | null;
  /**
   * How likely this one is to close, 0-100, when somebody has actually judged it.
   *
   * Null means "not overridden" and the STAGE decides — the same split the server draws
   * (`sales_contacts.probability_percent` defaults to 0, and `salesReports`'
   * `STAGE_PROBABILITY_PERCENT` fills the gap). Storing a per-stage default on every card
   * would be a policy nobody could change without editing every card that carries it.
   */
  probabilityPercent: number | null;
}

export interface PipelineModel {
  stages: string[];
  lanes: PipelineLane[];
  cards: PipelineCard[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Read the model off an authored object.
 *
 * Every fallback is deliberate: a pipeline with no `stages` gets the seven the
 * API knows, and one with no `swimlanes` gets a SINGLE unnamed lane rather than
 * none — a board with zero lanes would draw an empty frame and read as broken,
 * when what it actually is is a pipeline nobody has segmented yet.
 */
export function readPipelineModel(data: Record<string, unknown>): PipelineModel {
  const stages = (Array.isArray(data.stages) ? data.stages.map((stage) => text(stage, 32)).filter(Boolean) : [])
    .slice(0, PIPELINE_MAX_STAGES);

  const rawLanes = Array.isArray(data.swimlanes) ? data.swimlanes : Array.isArray(data.lanes) ? data.lanes : [];
  const lanes: PipelineLane[] = rawLanes.slice(0, PIPELINE_MAX_LANES).map((raw, index) => {
    const row = asRecord(raw);
    if (!row) return { id: `lane-${index}`, title: text(raw, 80) || `Lane ${index + 1}`, hint: '' };
    return {
      id: text(row.id, 40) || `lane-${index}`,
      title: text(row.title ?? row.name, 80) || `Lane ${index + 1}`,
      hint: text(row.hint ?? row.description, 160),
    };
  });

  const cards: PipelineCard[] = (Array.isArray(data.cards) ? data.cards : [])
    .map((raw, index): PipelineCard | null => {
      const row = asRecord(raw);
      if (!row) return null;
      const title = text(row.title ?? row.name);
      if (!title) return null;
      const probability = numberOrNull(row.probabilityPercent);
      const dealId = numberOrNull(row.dealId);
      return {
        id: text(row.id, 40) || `card-${index}`,
        dealId: dealId != null && Number.isInteger(dealId) && dealId > 0 ? dealId : null,
        lane: text(row.lane ?? row.swimlane, 40),
        stage: text(row.stage, 32),
        title,
        note: text(row.note ?? row.description, 240),
        valueCents: numberOrNull(row.valueCents),
        probabilityPercent: probability == null ? null : Math.min(100, Math.max(0, Math.round(probability))),
      };
    })
    .filter((card): card is PipelineCard => card != null);

  return {
    stages: stages.length ? stages : [...DEFAULT_PIPELINE_STAGES],
    lanes: lanes.length ? lanes : [{ id: 'all', title: '', hint: '' }],
    cards,
  };
}

/**
 * The cards at one intersection.
 *
 * A card whose `lane` matches nothing lands in the FIRST lane rather than
 * vanishing — an unplaced deal you cannot see is worse than one in the wrong row,
 * and this is exactly what happens when a lane is renamed.
 */
export function cardsAt(model: PipelineModel, laneIndex: number, stage: string): PipelineCard[] {
  const laneIds = new Set(model.lanes.map((lane) => lane.id));
  const lane = model.lanes[laneIndex];
  if (!lane) return [];
  return model.cards.filter((card) => {
    if (card.stage !== stage) return false;
    if (card.lane === lane.id) return true;
    return laneIndex === 0 && !laneIds.has(card.lane);
  });
}

/**
 * How likely a deal at each stage is to close, when nobody has judged the card itself.
 *
 * The SAME ladder the server's forecast uses (`salesReports.STAGE_PROBABILITY_PERCENT`).
 * Restated here rather than fetched because a board must weight its own cards while
 * offline and before any server round trip — and restated with the deliberate consequence
 * that `canvasSalesPipeline.test.ts` asserts the two agree, so a policy change that moves
 * one and not the other fails the build instead of producing a board and a report that
 * quietly forecast different numbers.
 */
export const PIPELINE_STAGE_PROBABILITY: Readonly<Record<string, number>> = {
  new: 5, contacted: 10, qualified: 25, meeting: 30, proposal: 60, won: 100, lost: 0,
};

/** The probability for one card: the human's judgement when they made one, the stage
 *  policy otherwise. */
export function cardProbabilityPercent(card: Pick<PipelineCard, 'stage' | 'probabilityPercent'>): number {
  if (card.probabilityPercent != null && card.probabilityPercent > 0) return card.probabilityPercent;
  return PIPELINE_STAGE_PROBABILITY[card.stage] ?? 0;
}

export interface PipelineStageTotals {
  count: number;
  valueCents: number;
  /** Value x probability. The number a forecast is made of, and the reason a stage full
   *  of `new` leads does not read as a quarter that is already won. */
  weightedCents: number;
  /** Cards in this stage carrying no value at all. Counted rather than hidden: a pipeline
   *  that looks small is usually one nobody has priced, and those are different problems. */
  unpriced: number;
}

/** Per-stage totals for the column headers — count, value, weighted value, and how much
 *  of the stage is unpriced. */
export function stageTotals(model: PipelineModel, stage: string): PipelineStageTotals {
  const rows = model.cards.filter((card) => card.stage === stage);
  let valueCents = 0;
  let weightedCents = 0;
  let unpriced = 0;
  for (const card of rows) {
    const value = card.valueCents ?? 0;
    valueCents += value;
    weightedCents += Math.round((value * cardProbabilityPercent(card)) / 100);
    if (card.valueCents == null || card.valueCents === 0) unpriced += 1;
  }
  return { count: rows.length, valueCents, weightedCents, unpriced };
}

export interface PipelineTotals {
  openCount: number;
  openValueCents: number;
  weightedCents: number;
  unpricedCount: number;
}

/**
 * The whole board's OPEN pipeline.
 *
 * Won and lost are excluded, which is the one decision worth naming: a weighted total that
 * counted closed revenue would double-count it against the quota it is being compared to,
 * and would make every pipeline look healthiest immediately after a deal landed.
 */
export function pipelineTotals(model: PipelineModel): PipelineTotals {
  let openCount = 0;
  let openValueCents = 0;
  let weightedCents = 0;
  let unpricedCount = 0;
  for (const card of model.cards) {
    if (card.stage === 'won' || card.stage === 'lost') continue;
    const value = card.valueCents ?? 0;
    openCount += 1;
    openValueCents += value;
    weightedCents += Math.round((value * cardProbabilityPercent(card)) / 100);
    if (card.valueCents == null || card.valueCents === 0) unpricedCount += 1;
  }
  return { openCount, openValueCents, weightedCents, unpricedCount };
}
