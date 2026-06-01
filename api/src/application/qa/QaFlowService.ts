/**
 * QaFlowService — derive testable flows from raw client journey events.
 *
 * A "flow" is a high-level navigation path through the app (the sequence of
 * routes a user visited in one session, with the interactions along the way).
 * Sessions that traverse the same route signature collapse into one flow whose
 * `frequency` reflects how many real sessions matched — so the generator can
 * prioritise the journeys users actually take.
 *
 * Aggregation is deterministic: a flow's slug is a hash of its route signature,
 * so re-running aggregation updates the same row (frequency refresh) instead of
 * spawning duplicates.
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { qaFlows, qaJourneyEvents } from '../../infrastructure/database/schema';
import { inferPersonaRole, type QaStep, shortHash, toSlug } from './qaTypes';

interface JourneyRow {
  sessionId: string;
  seq: number;
  type: string;
  route: string | null;
  selector: string | null;
  label: string | null;
  value: string | null;
}

/** Turn one ordered session's events into normalized steps. Consecutive
 *  duplicate pageviews collapse; the first pageview becomes the `goto`. */
function sessionToSteps(events: JourneyRow[]): QaStep[] {
  const steps: QaStep[] = [];
  let lastRoute: string | null = null;
  for (const ev of events) {
    switch (ev.type) {
      case 'pageview':
      case 'nav':
        if (ev.route && ev.route !== lastRoute) {
          steps.push({ action: 'goto', route: ev.route });
          steps.push({ action: 'expect', selector: ev.selector ?? undefined, assertion: `route ${ev.route} renders without an error boundary`, label: ev.label ?? undefined });
          lastRoute = ev.route;
        }
        break;
      case 'click':
        if (ev.selector) steps.push({ action: 'click', selector: ev.selector, label: ev.label ?? undefined });
        break;
      case 'input':
        if (ev.selector) steps.push({ action: 'fill', selector: ev.selector, value: '', label: ev.label ?? undefined });
        break;
      case 'submit':
        if (ev.selector) steps.push({ action: 'click', selector: ev.selector, label: ev.label ?? 'submit' });
        break;
    }
  }
  return steps;
}

/** Route signature = ordered, de-duplicated list of routes in a session. Used
 *  both to collapse sessions and to derive a stable slug. */
function routeSignature(steps: QaStep[]): string[] {
  const routes: string[] = [];
  for (const s of steps) {
    if (s.action === 'goto' && s.route && s.route !== routes[routes.length - 1]) {
      routes.push(s.route);
    }
  }
  return routes;
}

export class QaFlowService {
  constructor(private readonly db: Db) {}

  /**
   * Aggregate journey events from the last `sinceDays` into qa_flows.
   * Returns the number of distinct flows upserted. Sessions with fewer than two
   * routes are ignored — a single-page visit isn't a navigation flow worth a
   * smoke test.
   */
  async aggregate(
    tenantId: number,
    segmentId: string | undefined,
    opts: { sinceDays?: number; minRoutes?: number; maxFlows?: number; projectId?: number } = {},
  ): Promise<{ upserted: number }> {
    const sinceDays = opts.sinceDays ?? 30;
    const minRoutes = opts.minRoutes ?? 2;
    const maxFlows = opts.maxFlows ?? 50;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .select({
        sessionId: qaJourneyEvents.sessionId,
        seq:       qaJourneyEvents.seq,
        type:      qaJourneyEvents.type,
        route:     qaJourneyEvents.route,
        selector:  qaJourneyEvents.selector,
        label:     qaJourneyEvents.label,
        value:     qaJourneyEvents.value,
      })
      .from(qaJourneyEvents)
      .where(and(eq(qaJourneyEvents.tenantId, tenantId), gte(qaJourneyEvents.ts, since)))
      .orderBy(asc(qaJourneyEvents.sessionId), asc(qaJourneyEvents.seq))
      .limit(20_000);

    // Group ordered events by session.
    const bySession = new Map<string, JourneyRow[]>();
    for (const r of rows) {
      const list = bySession.get(r.sessionId) ?? [];
      list.push(r);
      bySession.set(r.sessionId, list);
    }

    // Collapse sessions by route signature; keep the richest representative.
    interface Agg { signature: string[]; steps: QaStep[]; frequency: number }
    const bySig = new Map<string, Agg>();
    for (const events of bySession.values()) {
      const steps = sessionToSteps(events);
      const sig = routeSignature(steps);
      if (sig.length < minRoutes) continue;
      const key = sig.join(' > ');
      const existing = bySig.get(key);
      if (!existing) {
        bySig.set(key, { signature: sig, steps, frequency: 1 });
      } else {
        existing.frequency += 1;
        if (steps.length > existing.steps.length) existing.steps = steps;
      }
    }

    const ranked = Array.from(bySig.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, maxFlows);

    let upserted = 0;
    const now = new Date();
    for (const agg of ranked) {
      const startRoute = agg.signature[0] ?? null;
      const name = agg.signature.join(' → ');
      const slug = `usage-${toSlug(agg.signature.join('-'))}-${shortHash(agg.signature.join('>'))}`;
      const personaRole = inferPersonaRole(agg.signature);
      await this.db
        .insert(qaFlows)
        .values({
          tenantId,
          segmentId,
          projectId: opts.projectId,
          name,
          slug,
          source: 'usage',
          description: `Auto-derived from ${agg.frequency} captured session(s).`,
          startRoute,
          steps: JSON.stringify(agg.steps),
          personaRole,
          frequency: agg.frequency,
          status: 'active',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [qaFlows.tenantId, qaFlows.slug],
          set: {
            steps: JSON.stringify(agg.steps),
            frequency: agg.frequency,
            name,
            startRoute,
            personaRole,
            updatedAt: now,
          },
        });
      upserted++;
    }
    return { upserted };
  }
}
