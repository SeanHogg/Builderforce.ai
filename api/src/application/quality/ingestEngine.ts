/**
 * Quality ingest engine — the one write path every source funnels into.
 *
 * Takes already-normalized canonical events (an adapter produced them) plus the
 * source they arrived on, and: (1) gates against the tenant's monthly error-event
 * allowance, (2) upserts the fingerprint-grouped `error_groups` row (bumping
 * counts / last-seen / refreshing the sample), (3) appends the raw `error_events`
 * rows — which ARE the consumption ledger (sumTenantErrorEvents counts them), so
 * there is no second "record" write — and (4) bumps the dashboard cache version.
 *
 * neon-http safe: no interactive transaction. Group upserts run per-event (they
 * need the returned id); event rows are bulk-inserted in one statement.
 */

import { eq, sql } from 'drizzle-orm';
import { errorGroups, errorEvents, errorSources } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { computeFingerprint, eventTitle, type NormalizedErrorEvent } from './errorSpec';
import { enforceErrorEventsCap } from './errorEventsLedger';

/** Version key for a project's cached error-group lists (folded into list cache keys). */
export function qualityGroupsVersionKey(projectId: number): string {
  return `quality-groups-version:project:${projectId}`;
}

/** Version key for a tenant's all-projects cached error-group lists. */
export function qualityGroupsTenantVersionKey(tenantId: number): string {
  return `quality-groups-version:tenant:${tenantId}`;
}

export interface IngestSourceRef {
  id: string;
  tenantId: number;
  projectId: number;
}

export interface IngestResult {
  accepted: number;
  dropped: number;
  /** Set when the monthly cap rejected the batch. */
  capExceeded?: boolean;
}

/**
 * Ingest a batch of canonical events for one source. Best-effort per event: a
 * single malformed/duplicate event never fails the rest of the batch.
 */
export async function ingestErrorEvents(
  db: Db,
  env: Env,
  source: IngestSourceRef,
  events: NormalizedErrorEvent[],
): Promise<IngestResult> {
  if (events.length === 0) return { accepted: 0, dropped: 0 };

  // Monthly allowance gate — graceful backpressure: stored data stays usable,
  // only NEW ingestion stops. Fails open on a metering error (see the ledger).
  const cap = await enforceErrorEventsCap(db, source.tenantId);
  if (!cap.allowed) return { accepted: 0, dropped: events.length, capExceeded: true };

  const now = new Date();
  const eventRows: Array<typeof errorEvents.$inferInsert> = [];
  let dropped = 0;

  for (const e of events) {
    try {
      const fingerprint = await computeFingerprint(e);
      const seenAt = parseTs(e.timestamp) ?? now;
      const level = e.level;

      const [grp] = await db
        .insert(errorGroups)
        .values({
          tenantId: source.tenantId,
          projectId: source.projectId,
          sourceId: source.id,
          fingerprint,
          title: eventTitle(e),
          type: e.type ?? null,
          culprit: e.url ?? null,
          level,
          status: 'unresolved',
          eventCount: 1,
          userCount: e.userKey ? 1 : 0,
          firstSeen: seenAt,
          lastSeen: seenAt,
          release: e.release ?? null,
          environment: e.environment ?? null,
          samplePayload: e as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [errorGroups.tenantId, errorGroups.projectId, errorGroups.fingerprint],
          set: {
            eventCount: sql`${errorGroups.eventCount} + 1`,
            // Approximate distinct-user count (overcounts repeat users); the group
            // detail view recomputes the exact figure from error_events.
            userCount: sql`${errorGroups.userCount} + ${e.userKey ? 1 : 0}`,
            lastSeen: sql`GREATEST(${errorGroups.lastSeen}, ${seenAt})`,
            // A resolved bug that recurs is a regression — reopen it; ignored stays ignored.
            status: sql`CASE WHEN ${errorGroups.status} = 'resolved' THEN 'unresolved' ELSE ${errorGroups.status} END`,
            level,
            release: e.release ?? null,
            environment: e.environment ?? null,
            samplePayload: e as unknown as Record<string, unknown>,
            updatedAt: now,
          },
        })
        .returning({ id: errorGroups.id });

      if (!grp) { dropped++; continue; }

      eventRows.push({
        groupId: grp.id,
        tenantId: source.tenantId,
        ts: seenAt,
        release: e.release ?? null,
        environment: e.environment ?? null,
        userKey: e.userKey ?? null,
        payload: e as unknown as Record<string, unknown>,
        createdAt: now,
      });
    } catch {
      dropped++;
    }
  }

  if (eventRows.length > 0) {
    try {
      await db.insert(errorEvents).values(eventRows);
    } catch {
      // The groups were already upserted; losing the raw event rows only affects
      // the meter/trend, never the dashboard's group view. Best-effort.
    }
    await db.update(errorSources).set({ lastEventAt: now }).where(eq(errorSources.id, source.id)).catch(() => {});
    await bumpCacheVersion(env, qualityGroupsVersionKey(source.projectId));
    await bumpCacheVersion(env, qualityGroupsTenantVersionKey(source.tenantId));
  }

  return { accepted: eventRows.length, dropped };
}

/** Parse an ISO/epoch timestamp tolerantly; null when unparseable. */
function parseTs(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
