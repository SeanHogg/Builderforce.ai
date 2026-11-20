/**
 * The ONE step that follows every write of a roadmap item — the REST roadmap tracker
 * (`productRoutes` `/roadmap`) and the Brain's roadmap tools (`roadmap.create` /
 * `roadmap.update` / `roadmap.delete`) both call {@link afterRoadmapWrite}, so a roadmap item
 * the agent ships is announced and its cached list refreshed exactly like one shipped by hand.
 *
 * - Cache: the roadmap tracker's read-through keys (the portfolio `:all` key plus the project
 *   key of the row before AND after the write, so a move between projects clears both) and the
 *   chat ↔ ticket typeahead version (a roadmap item is a link-picker ticket kind).
 * - Webhook: `roadmap.published` fires on a TRANSITION into `shipped` only — never on a save of
 *   an item that was already shipped (the tracker used to re-announce on every save).
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpTicketSearchVersion, invalidateCached, trackerCacheKeysForWrite } from '../../infrastructure/cache/readThroughCache';
import { checkTicketStatus } from '@builderforce/agent-loop';
import { emitWebhookEvent } from '../seams/webhookService';
import { isTransitionInto, transitionEventId } from '../seams/webhookTransition';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The roadmap tracker's cache namespace (`trackerCacheKey`). */
export const ROADMAP_CACHE_NS = 'roadmap';

/** The status that publishes a roadmap item. */
export const ROADMAP_PUBLISHED_STATUS = 'shipped';

type Row = Record<string, unknown>;

/**
 * `row` with its status read the way the registry reads it: a legacy delivered spelling
 * (`released`, `done` …) or a different case (`Shipped`) is the `shipped` it stands for, so an
 * item that was already delivered under an old word is not re-announced when it is saved as
 * `shipped`. An off-vocabulary status is kept as is.
 */
function roadmapStatusAsStored(row: Row | null): Row | null {
  if (!row || row.status == null) return row;
  const checked = checkTicketStatus('roadmap', row.status);
  return checked.ok ? { ...row, status: checked.value } : row;
}

export interface RoadmapWriteScope {
  db: Db;
  /** No Worker env (a unit test, a CLI) ⇒ there is no cache to invalidate. */
  env?: Env;
  tenantId: number;
  segmentId: string;
  /** Defer the webhook past the response when the runtime offers it; otherwise it is awaited. */
  waitUntil?: (work: Promise<unknown>) => void;
}

const SOURCE = 'application/delivery/roadmapWrite.ts';

/** Run after a roadmap item is created (`before` null), updated, or deleted (`after` null). */
export async function afterRoadmapWrite(scope: RoadmapWriteScope, before: Row | null, after: Row | null): Promise<void> {
  const { db, env, tenantId, segmentId } = scope;
  if (env) {
    for (const key of trackerCacheKeysForWrite(ROADMAP_CACHE_NS, tenantId, segmentId, before, after)) {
      await invalidateCached(env, key).catch((error) => {
        reportCaughtError(error, { source: SOURCE, operation: 'afterRoadmapWrite.invalidate', context: { key } });
      });
    }
    await bumpTicketSearchVersion(env, tenantId);
  }
  if (!after || !isTransitionInto('status', ROADMAP_PUBLISHED_STATUS, roadmapStatusAsStored(before), after)) return;
  const eventId = transitionEventId(after, ROADMAP_PUBLISHED_STATUS);
  const emit = emitWebhookEvent(db, { tenantId, segmentId, eventType: 'roadmap.published', eventId, data: after }, { env })
    .catch((error) => {
      reportCaughtError(error, { source: SOURCE, operation: 'afterRoadmapWrite.emit', context: { eventId } });
    });
  if (scope.waitUntil) scope.waitUntil(emit);
  else await emit;
}
