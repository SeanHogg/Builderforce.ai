import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { visitorFlowCacheKey } from './marketingCacheKeys';
import {
  buildVisitorFlowGraph,
  type VisitorFlowGraph,
} from '../../domain/marketing/visitorFlowGraph';

/**
 * Where anonymous visitors GO — the read side of the journey.
 *
 * Two questions, deliberately answered by two methods rather than one shape
 * that half-serves both:
 *
 *   • {@link flowGraph} — the aggregate. "Prompt → where → dropped or converted",
 *     across everyone in a window. This is the funnel-leak view, and it is a
 *     GRAPH rather than a stage table because a leak is a property of an edge:
 *     a stage count can tell you 400 people saw pricing, never that 300 of them
 *     came from the prompt and 280 of those left there.
 *   • {@link journeyFor} — one visitor's actual sequence, visit by visit, with
 *     what they typed and what broke. The evidence behind a number in the graph.
 *
 * The aggregation itself is pure and lives in the domain
 * (`visitorFlowGraph.ts`); this class owns only the queries and the cache.
 */

/** One step on a single visitor's timeline. */
export interface VisitorJourneyStep {
  at: string;
  kind: string;
  path: string | null;
  /** The prompt text, on a `prompt` step. */
  prompt: string | null;
  metadata: Record<string, unknown> | null;
}

/** One contiguous run of activity — the unit "they left" and "came back" are about. */
export interface VisitorVisit {
  visitId: string | null;
  startedAt: string;
  endedAt: string;
  /** Wall-clock span of the visit. Null when only one event landed in it. */
  durationMs: number | null;
  steps: VisitorJourneyStep[];
}

export interface VisitorJourney {
  visitorId: string;
  visits: VisitorVisit[];
  totals: {
    visits: number;
    pageViews: number;
    prompts: number;
    errors: number;
  };
}

/** How far back the graph looks by default, and the ceiling a caller may ask for. */
export const VISITOR_FLOW_WINDOWS = { defaultDays: 30, maxDays: 90 } as const;

/** Rows read per window. A bound, not a page: the graph is an aggregate, and an
 *  unbounded scan over a telemetry stream is how a read endpoint becomes an
 *  incident. Reported in `truncated` so a partial graph never reads as complete. */
const EVENT_SCAN_LIMIT = 50_000;
const PROMPT_SCAN_LIMIT = 10_000;
const JOURNEY_EVENT_LIMIT = 500;

export interface VisitorFlowResult extends VisitorFlowGraph {
  windowDays: number;
  /** True when the scan hit its ceiling — the graph is of the most recent slice. */
  truncated: boolean;
}

export class VisitorJourneyService {
  constructor(private readonly db: Db) {}

  /**
   * The aggregate flow, read-through cached.
   *
   * Three scans and one in-memory fold, not a per-node query: the alternative is
   * a fan-out that grows with the number of distinct paths, which is the shape
   * that makes a funnel panel unusable exactly when traffic makes it interesting.
   * Sixty seconds of staleness on an append-only stream costs nothing.
   */
  async flowGraph(env: Env, days: number): Promise<VisitorFlowResult> {
    const windowDays = clampDays(days);
    return getOrSetCached(env, visitorFlowCacheKey(windowDays), async () => {
      const [events, prompts, conversions] = await Promise.all([
        this.loadEvents(windowDays),
        this.loadPrompts(windowDays),
        this.loadConversions(windowDays),
      ]);
      const graph = buildVisitorFlowGraph({ events, prompts, conversions });
      return {
        ...graph,
        windowDays,
        truncated: events.length >= EVENT_SCAN_LIMIT || prompts.length >= PROMPT_SCAN_LIMIT,
      };
    }, { kvTtlSeconds: 60 });
  }

  /**
   * One visitor's journey, newest visit first.
   *
   * Not cached: this is opened from a row in the console for a specific lead,
   * where the freshest answer is the point, and it is one indexed read.
   */
  async journeyFor(visitorId: string): Promise<VisitorJourney> {
    const [events, prompts] = await Promise.all([
      this.db.execute(sql`
        SELECT visit_id AS "visitId", kind, path, metadata, occurred_at AS "occurredAt"
        FROM visitor_events
        WHERE visitor_id = ${visitorId}
        ORDER BY occurred_at DESC
        LIMIT ${JOURNEY_EVENT_LIMIT}
      `),
      this.db.execute(sql`
        SELECT visit_id AS "visitId", prompt, surface, created_at AS "createdAt"
        FROM marketing_session_prompts
        WHERE visitor_id = ${visitorId}
        ORDER BY created_at DESC
        LIMIT ${JOURNEY_EVENT_LIMIT}
      `),
    ]);

    return assembleJourney(
      visitorId,
      events.rows as unknown as EventRow[],
      prompts.rows as unknown as PromptRow[],
    );
  }

  private async loadEvents(days: number) {
    const rows = await this.db.execute(sql`
      SELECT visitor_id AS "visitorId", visit_id AS "visitId", kind, path,
             occurred_at AS "occurredAt"
      FROM visitor_events
      WHERE occurred_at > now() - (${days}::text || ' days')::interval
      ORDER BY occurred_at ASC
      LIMIT ${EVENT_SCAN_LIMIT}
    `);
    return rows.rows as unknown as { visitorId: string; visitId: string | null; kind: string; path: string | null; occurredAt: string }[];
  }

  private async loadPrompts(days: number) {
    const rows = await this.db.execute(sql`
      SELECT visitor_id AS "visitorId", visit_id AS "visitId", prompt, surface,
             created_at AS "createdAt"
      FROM marketing_session_prompts
      WHERE created_at > now() - (${days}::text || ' days')::interval
      ORDER BY created_at ASC
      LIMIT ${PROMPT_SCAN_LIMIT}
    `);
    return rows.rows as unknown as { visitorId: string; visitId: string | null; prompt: string; surface: string; createdAt: string }[];
  }

  /** Conversion is a fact on the lead row, not an event — read it from there
   *  rather than inferring it from a `signup` event that may never have fired. */
  private async loadConversions(days: number) {
    const rows = await this.db.execute(sql`
      SELECT visitor_id AS "visitorId", converted
      FROM marketing_sessions
      WHERE last_seen_at > now() - (${days}::text || ' days')::interval
    `);
    return rows.rows as unknown as { visitorId: string; converted: boolean }[];
  }
}

interface EventRow {
  visitId: string | null;
  kind: string;
  path: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

interface PromptRow {
  visitId: string | null;
  prompt: string;
  surface: string;
  createdAt: string;
}

/**
 * Interleave the two streams into visits.
 *
 * Pure, and exported for the test: the ordering rule ("a prompt sits where its
 * timestamp puts it, not at the top of the visit") is the whole reason this
 * timeline is readable, and it is worth asserting rather than eyeballing.
 */
export function assembleJourney(
  visitorId: string,
  events: EventRow[],
  prompts: PromptRow[],
): VisitorJourney {
  const steps: (VisitorJourneyStep & { visitId: string | null; atMs: number })[] = [
    ...events.map((e) => ({
      visitId: e.visitId,
      atMs: Date.parse(e.occurredAt),
      at: e.occurredAt,
      kind: e.kind,
      path: e.path,
      prompt: null,
      metadata: e.metadata,
    })),
    ...prompts.map((p) => ({
      visitId: p.visitId,
      atMs: Date.parse(p.createdAt),
      at: p.createdAt,
      kind: 'prompt',
      path: p.surface,
      prompt: p.prompt,
      metadata: null,
    })),
  ].sort((a, b) => a.atMs - b.atMs);

  const byVisit = new Map<string, (typeof steps)>();
  for (const step of steps) {
    const key = step.visitId ?? 'legacy';
    const bucket = byVisit.get(key) ?? [];
    bucket.push(step);
    byVisit.set(key, bucket);
  }

  const visits: VisitorVisit[] = [...byVisit.entries()].map(([key, bucket]) => {
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    return {
      visitId: key === 'legacy' ? null : key,
      startedAt: first.at,
      endedAt: last.at,
      durationMs: bucket.length > 1 ? last.atMs - first.atMs : null,
      steps: bucket.map(({ at, kind, path, prompt, metadata }) => ({ at, kind, path, prompt, metadata })),
    };
  }).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  return {
    visitorId,
    visits,
    totals: {
      visits: visits.length,
      pageViews: events.filter((e) => e.kind === 'page_view').length,
      prompts: prompts.length,
      errors: events.filter((e) => e.kind === 'error').length,
    },
  };
}

function clampDays(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return VISITOR_FLOW_WINDOWS.defaultDays;
  return Math.min(Math.floor(days), VISITOR_FLOW_WINDOWS.maxDays);
}
