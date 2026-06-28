/**
 * LENS — "People" (the board-deck People slide): the headcount time-series that
 * nothing else collects, composed with the EXISTING DevEx survey lens (developer
 * satisfaction) and member_profiles.ramp_factor (new-hire ramp). Reads the new
 * collectors (headcount_events, open_positions, migration 0237) and produces:
 *
 *   - headcount waterfall (per-month hires / departures / net / end headcount),
 *   - attrition rate (leaves in window ÷ avg headcount) + voluntary split,
 *   - ramping members (member_profiles.ramp_factor < 1),
 *   - high-priority open positions (req title / days open / target start),
 *   - developer satisfaction (reused from computeDevexInsights — no re-collection).
 *
 * Aggregation is pure ({@link summarizePeople}) over already-fetched rows so it is
 * unit-testable without a DB; {@link computePeopleInsights} does the I/O + reuse.
 */

import { and, asc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { headcountEvents, openPositions, memberProfiles } from '../../infrastructure/database/schema';
import { computeDevexInsights } from './devexInsights';

const DAY_MS = 86_400_000;
const MAX_EVENT_ROWS = 10_000;

export interface HeadcountEventRow {
  eventType: string;          // hire | leave | transfer
  effectiveOn: string;        // 'YYYY-MM-DD' (date column)
  isVoluntary: boolean | null;
}
export interface OpenPositionRow {
  reqTitle: string;
  priority: string;
  status: string;
  openedOn: string;           // 'YYYY-MM-DD'
  targetStartOn: string | null;
}
export interface RampRow { memberRef: string; rampFactor: number; }

export interface WaterfallMonth {
  month: string;              // 'YYYY-MM'
  hires: number;
  departures: number;
  net: number;
  endHeadcount: number;
}
export interface OpenPositionView {
  reqTitle: string;
  priority: string;
  daysOpen: number;
  targetStartOn: string | null;
}
export interface PeopleInsights {
  windowMonths: number;
  waterfall: WaterfallMonth[];
  attritionRatePct: number | null;
  voluntaryAttritionPct: number | null;
  rampingMembers: Array<{ memberRef: string; rampFactor: number; rampPct: number }>;
  openPositions: OpenPositionView[];
  devSatisfaction: { score: number | null; enps: number; responses: number };
}

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/**
 * Pure: assemble the People lens from already-fetched rows. `allEvents` is the
 * FULL event history (oldest→newest) so absolute end-of-month headcount is a
 * running cumulative; `windowMonths` bounds the waterfall + attrition window.
 * `now` anchors days-open. `devSatisfaction` is the reused DevEx summary.
 */
export function summarizePeople(
  allEvents: HeadcountEventRow[],
  positions: OpenPositionRow[],
  ramps: RampRow[],
  windowMonths: number,
  now: number,
  devSatisfaction: { score: number | null; enps: number; responses: number },
): PeopleInsights {
  // Running headcount across ALL history, bucketed by month.
  const byMonth = new Map<string, { hires: number; departures: number }>();
  for (const e of allEvents) {
    const m = monthOf(e.effectiveOn);
    const b = byMonth.get(m) ?? { hires: 0, departures: 0 };
    if (e.eventType === 'hire') b.hires += 1;
    else if (e.eventType === 'leave') b.departures += 1;
    byMonth.set(m, b);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort();
  const running: WaterfallMonth[] = [];
  let cumulative = 0;
  for (const m of sortedMonths) {
    const b = byMonth.get(m)!;
    const net = b.hires - b.departures;
    cumulative += net;
    running.push({ month: m, hires: b.hires, departures: b.departures, net, endHeadcount: cumulative });
  }
  // Keep only the most recent `windowMonths` for display.
  const waterfall = running.slice(-windowMonths);

  // Attrition over the window: leaves ÷ avg(headcount) across the window months.
  const windowRows = waterfall;
  const leaves = windowRows.reduce((a, r) => a + r.departures, 0);
  const voluntary = (() => {
    const cutoff = monthOf(new Date(now - windowMonths * 30 * DAY_MS).toISOString().slice(0, 10));
    const vol = allEvents.filter((e) => e.eventType === 'leave' && monthOf(e.effectiveOn) >= cutoff && e.isVoluntary === true).length;
    return vol;
  })();
  const avgHeadcount = windowRows.length ? windowRows.reduce((a, r) => a + r.endHeadcount, 0) / windowRows.length : 0;
  const attritionRatePct = avgHeadcount > 0 ? (leaves / avgHeadcount) * 100 : null;
  const voluntaryAttritionPct = avgHeadcount > 0 ? (voluntary / avgHeadcount) * 100 : null;

  const rampingMembers = ramps
    .filter((r) => r.rampFactor < 1)
    .sort((a, b) => a.rampFactor - b.rampFactor)
    .map((r) => ({ memberRef: r.memberRef, rampFactor: r.rampFactor, rampPct: Math.round(r.rampFactor * 100) }));

  const openPositionViews: OpenPositionView[] = positions
    .filter((p) => p.status === 'open')
    .map((p) => ({
      reqTitle: p.reqTitle,
      priority: p.priority,
      daysOpen: Math.max(0, Math.floor((now - new Date(p.openedOn).getTime()) / DAY_MS)),
      targetStartOn: p.targetStartOn,
    }))
    // High priority first, then longest-open.
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1) || b.daysOpen - a.daysOpen);

  return {
    windowMonths,
    waterfall,
    attritionRatePct,
    voluntaryAttritionPct,
    rampingMembers,
    openPositions: openPositionViews,
    devSatisfaction,
  };
}

/** I/O: fetch headcount history + positions + ramp factors, reuse the DevEx lens,
 *  and assemble the People lens. `months` bounds the waterfall window (default 6). */
export async function computePeopleInsights(db: Db, tenantId: number, months = 6): Promise<PeopleInsights> {
  const now = Date.now();

  const [allEvents, positions, ramps, devex] = await Promise.all([
    db.select({ eventType: headcountEvents.eventType, effectiveOn: headcountEvents.effectiveOn, isVoluntary: headcountEvents.isVoluntary })
      .from(headcountEvents)
      .where(eq(headcountEvents.tenantId, tenantId))
      .orderBy(asc(headcountEvents.effectiveOn))
      .limit(MAX_EVENT_ROWS) as Promise<HeadcountEventRow[]>,
    db.select({ reqTitle: openPositions.reqTitle, priority: openPositions.priority, status: openPositions.status, openedOn: openPositions.openedOn, targetStartOn: openPositions.targetStartOn })
      .from(openPositions)
      .where(and(eq(openPositions.tenantId, tenantId), eq(openPositions.status, 'open'))) as Promise<OpenPositionRow[]>,
    db.select({ memberRef: memberProfiles.memberRef, rampFactor: memberProfiles.rampFactor })
      .from(memberProfiles)
      .where(and(eq(memberProfiles.tenantId, tenantId), lt(memberProfiles.rampFactor, 1))) as Promise<RampRow[]>,
    computeDevexInsights(db, tenantId, months * 30),
  ]);

  const satScores = devex.byDimension.map((d) => d.avgScore);
  const devSatisfaction = {
    score: satScores.length ? Math.round((satScores.reduce((a, b) => a + b, 0) / satScores.length) * 10) / 10 : null,
    enps: devex.enps,
    responses: devex.totalResponses,
  };

  return summarizePeople(allEvents, positions, ramps, months, now, devSatisfaction);
}
