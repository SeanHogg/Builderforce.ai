/**
 * LENS #5 — Innovation funnel over `innovation_ideas` (gate insights.portfolio / CEO).
 *
 * The CEO headline: idea→validated→in_build→shipped→measured conversion +
 * time-to-value. Because the stages are linear, an idea currently at a later
 * stage has, by construction, passed the earlier ones — so cumulative "reached
 * stage N" is derivable from the single `stage` column (no event log needed).
 *
 * {@link computeFunnelMetrics} is pure for unit testing; the route caches it.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { innovationIdeas } from '../../infrastructure/database/schema';

const DAY_MS = 86_400_000;

/** The linear funnel order. `killed` is an off-ramp, not a stage. */
export const FUNNEL_STAGES = ['idea', 'validated', 'in_build', 'shipped', 'measured'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

function stageIndex(stage: string): number {
  const i = (FUNNEL_STAGES as readonly string[]).indexOf(stage);
  return i; // -1 for 'killed'/unknown
}

export interface IdeaRow {
  stage: string;
  createdAt: Date;
  stageEnteredAt: Date;
}

export interface FunnelMetrics {
  totalIdeas: number;
  activeIdeas: number; // non-killed
  killedCount: number;
  ideaToShipPct: number | null; // reached shipped / active
  avgIdeaToShipDays: number | null;
  stages: Array<{
    stage: FunnelStage;
    current: number;        // ideas whose stage === this
    reached: number;        // ideas that reached this stage or beyond (cumulative)
    conversionFromPrevPct: number | null; // reached[i] / reached[i-1]
    avgDaysInStage: number | null;        // for ideas currently here: now - stageEnteredAt
  }>;
}

/** Pure: compute the funnel rollup from idea rows at a reference `now`. */
export function computeFunnelMetrics(ideas: IdeaRow[], now: number): FunnelMetrics {
  const active = ideas.filter((i) => i.stage !== 'killed');
  const killedCount = ideas.length - active.length;

  const reachedAt = (idx: number) => active.filter((i) => stageIndex(i.stage) >= idx).length;
  const currentAt = (idx: number) => active.filter((i) => stageIndex(i.stage) === idx);

  const stages = FUNNEL_STAGES.map((stage, idx) => {
    const here = currentAt(idx);
    const reached = reachedAt(idx);
    const prevReached = idx === 0 ? active.length : reachedAt(idx - 1);
    const daysHere = here.map((i) => (now - new Date(i.stageEnteredAt).getTime()) / DAY_MS).filter((d) => d >= 0);
    return {
      stage,
      current: here.length,
      reached,
      conversionFromPrevPct: idx === 0 ? null : prevReached > 0 ? (reached / prevReached) * 100 : null,
      avgDaysInStage: daysHere.length ? daysHere.reduce((a, b) => a + b, 0) / daysHere.length : null,
    };
  });

  // idea→ship: reached the shipped stage (index 3) or beyond.
  const shippedIdx = stageIndex('shipped');
  const shippedOrBeyond = active.filter((i) => stageIndex(i.stage) >= shippedIdx);
  const ideaToShipPct = active.length ? (shippedOrBeyond.length / active.length) * 100 : null;
  // time-to-value: createdAt → entered-shipped (approx via stageEnteredAt for those at/after shipped).
  const ttv = shippedOrBeyond
    .map((i) => (new Date(i.stageEnteredAt).getTime() - new Date(i.createdAt).getTime()) / DAY_MS)
    .filter((d) => d >= 0);

  return {
    totalIdeas: ideas.length,
    activeIdeas: active.length,
    killedCount,
    ideaToShipPct,
    avgIdeaToShipDays: ttv.length ? ttv.reduce((a, b) => a + b, 0) / ttv.length : null,
    stages,
  };
}

export async function computeFunnel(
  db: Db,
  tenantId: number,
  segmentId: string,
  initiativeId: string | undefined,
  now: number,
): Promise<FunnelMetrics> {
  const conds = [eq(innovationIdeas.tenantId, tenantId), eq(innovationIdeas.segmentId, segmentId)];
  if (initiativeId) conds.push(eq(innovationIdeas.initiativeId, initiativeId));
  const rows = (await db
    .select({ stage: innovationIdeas.stage, createdAt: innovationIdeas.createdAt, stageEnteredAt: innovationIdeas.stageEnteredAt })
    .from(innovationIdeas)
    .where(and(...conds))) as IdeaRow[];
  return computeFunnelMetrics(rows, now);
}
