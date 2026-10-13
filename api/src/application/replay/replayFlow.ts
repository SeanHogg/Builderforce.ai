/**
 * The Insights flow (PRD 33 §2.1, §6 "one flow fold (`buildVisitorFlowGraph`)").
 *
 * Kept recordings' ordered `steps` are PROJECTED into the `VisitorFlowRow[]` shape
 * the visitor-journey graph already folds, and that one fold builds the graph —
 * there is no second graph builder for replay. A `page:<route>` step is a page view
 * on that route; an `event:<name>` step is a named step; a recording with errors
 * ends on an error node; a converted recording ends at `converted` (the fold adds
 * it from the conversions list); every other recording ends at `exit`.
 *
 * Recordings are scanned with the shared bounded keyset scan (≈, weighted reading);
 * the answer is cached per (days, filter) under the site version.
 */

import type { ReplayFilter, ReplayFlowDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { VISITOR_JOURNEY_KINDS } from '../../domain/marketing/VisitorJourney';
import {
  buildVisitorFlowGraph,
  type VisitorFlowConversion,
  type VisitorFlowRow,
} from '../../domain/marketing/visitorFlowGraph';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { interpolateStepTimes } from '../../domain/replay/funnelFold';
import { replayReadKeys } from './replayCacheKeys';
import { replayTelemetryDb } from './replayDatabase';
import { clampDays, filterCacheKey } from './replayReadModel';
import { compileScopeFilter } from './replaySmartEventRules';
import { scanKeptRecordings, type KeptScanRow } from './replayKeptScan';

const TTL = { kvTtlSeconds: 300, l1TtlMs: 30_000 };
/** Nodes the flow keeps (the fold trims the long tail and says so in its totals). */
export const FLOW_MAX_NODES = 24;

/** One kept recording as the visitor-journey rows the graph fold reads. */
export function recordingFlowRows(row: Pick<KeptScanRow, 'visitorId' | 'visitId' | 'startedAt' | 'durationMs' | 'steps' | 'errorCount' | 'converted'>): VisitorFlowRow[] {
  const start = new Date(row.startedAt).getTime();
  const rows: VisitorFlowRow[] = [];
  for (const step of interpolateStepTimes(row.steps, row.durationMs)) {
    const colon = step.token.indexOf(':');
    const kind = step.token.slice(0, colon);
    const key = step.token.slice(colon + 1);
    const occurredAt = new Date(start + step.atMs);
    if (kind === 'page') rows.push({ visitorId: row.visitorId, visitId: row.visitId, kind: VISITOR_JOURNEY_KINDS.pageView, path: key || '/', occurredAt });
    else if (kind === 'event' && key) rows.push({ visitorId: row.visitorId, visitId: row.visitId, kind: key, path: null, occurredAt });
  }
  // A converted visit ends at `converted` (added by the fold); otherwise it ends on an error or at exit.
  if (!row.converted) {
    const end = new Date(start + row.durationMs + 1);
    rows.push({
      visitorId: row.visitorId,
      visitId: row.visitId,
      kind: row.errorCount > 0 ? VISITOR_JOURNEY_KINDS.error : VISITOR_JOURNEY_KINDS.visitEnd,
      path: row.errorCount > 0 ? 'error' : null,
      occurredAt: end,
    });
  }
  return rows;
}

export async function replayFlow(
  env: Env,
  db: Db,
  scope: ReplayScope,
  input: { days?: number; filter?: ReplayFilter | null; now?: Date } = {},
): Promise<ReplayFlowDto> {
  const days = clampDays(input.days);
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.flow(days, filterCacheKey(input.filter)), async () => {
    const { where } = await compileScopeFilter(env, db, scope, input.filter);
    const scan = await scanKeptRecordings(replayTelemetryDb(env, db), scope, {
      since: new Date((input.now ?? new Date()).getTime() - days * 86_400_000),
      where,
    });
    const conversions: VisitorFlowConversion[] = [];
    const seen = new Set<string>();
    for (const row of scan.rows) {
      if (row.converted && !seen.has(row.visitorId)) {
        seen.add(row.visitorId);
        conversions.push({ visitorId: row.visitorId, converted: true });
      }
    }
    return buildVisitorFlowGraph({
      events: scan.rows.flatMap(recordingFlowRows),
      prompts: [],
      conversions,
      maxNodes: FLOW_MAX_NODES,
    });
  }, TTL);
}
