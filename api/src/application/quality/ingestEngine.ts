import { reportCaughtError } from '../observability/caughtErrorReporter';
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
import { errorGroups, errorEvents, errorCollectors, errorGroupUsers } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { computeFingerprint, eventTitle, type NormalizedErrorEvent } from './errorSpec';
import { enforceErrorEventsCap } from './errorEventsLedger';
import { resolveEventProjectId, type CollectorRef, type MappingRule } from './errorMapping';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';

/** Version key for a project's cached error-group lists (folded into list cache keys). */
export function qualityGroupsVersionKey(projectId: number): string {
  return `quality-groups-version:project:${projectId}`;
}

/** Version key for a tenant's all-projects cached error-group lists. */
export function qualityGroupsTenantVersionKey(tenantId: number): string {
  return `quality-groups-version:tenant:${tenantId}`;
}

export interface IngestResult {
  accepted: number;
  dropped: number;
  /**
   * The subset of `dropped` that was UNROUTABLE — a tenant-level collector saw
   * the event, no mapping rule matched it and no `defaultProjectId` is set.
   *
   * Reported separately because it is a different KIND of fact from the rest of
   * `dropped` (an event that threw mid-upsert): it names a configuration the
   * operator can fix, it is not transient, and it is invisible everywhere else —
   * the caller's HTTP response is the only place the old lumped number appeared,
   * and no operator reads an ingest 202 body. It is also persisted onto the
   * collector (`unmapped_event_count`) so the collector list can say it.
   */
  unmapped: number;
  /** Set when the monthly cap rejected the batch. */
  capExceeded?: boolean;
}

/**
 * Ingest a batch of canonical events for one collector. Each event is routed to a
 * concrete project: a project collector to its project; a tenant-level collector
 * via mapping rules (or defaultProjectId). Unroutable events are dropped (counted).
 * `rules` MUST be ordered by ascending priority. Best-effort per event.
 */
export async function ingestErrorEvents(
  db: Db,
  env: Env,
  collector: CollectorRef,
  events: NormalizedErrorEvent[],
  rules: MappingRule[] = [],
): Promise<IngestResult> {
  if (events.length === 0) return { accepted: 0, dropped: 0, unmapped: 0 };

  // Monthly allowance gate — graceful backpressure: stored data stays usable,
  // only NEW ingestion stops. Fails open on a metering error (see the ledger).
  // `env` matters here: it serves the superadmin-unlimited lookup through the
  // 5-min read-through cache. Without it this ingest path — the hottest one in the
  // system — ran an extra uncached membership query per batch on every capped tenant.
  const cap = await enforceErrorEventsCap(db, collector.tenantId, env);
  if (!cap.allowed) return { accepted: 0, dropped: events.length, unmapped: 0, capExceeded: true };

  const now = new Date();
  const eventRows: Array<typeof errorEvents.$inferInsert> = [];
  // Candidate (group, user) pairs for the EXACT distinct-user count (deduped below).
  const userPairKeys = new Set<string>();
  const userPairs: Array<{ groupId: string; userKey: string }> = [];
  // Projects touched this batch (a tenant collector can fan across several).
  const touchedProjects = new Set<number>();
  let dropped = 0;
  // Dropped BECAUSE nothing routes it, as opposed to dropped because it threw.
  let unmapped = 0;

  for (const e of events) {
    try {
      const projectId = resolveEventProjectId(e, collector, rules);
      if (projectId == null) { dropped++; unmapped++; continue; } // unmappable tenant-level event
      const fingerprint = await computeFingerprint(e);
      const seenAt = parseTs(e.timestamp) ?? now;
      const level = e.level;

      const [grp] = await db
        .insert(errorGroups)
        .values({
          tenantId: collector.tenantId,
          projectId,
          collectorId: collector.id,
          fingerprint,
          title: eventTitle(e),
          type: e.type ?? null,
          culprit: e.url ?? null,
          level,
          status: 'unresolved',
          eventCount: 1,
          // user_count is owned by the error_group_users set below (exact distinct);
          // never incremented here, or repeat users would inflate it.
          userCount: 0,
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
      touchedProjects.add(projectId);

      eventRows.push({
        groupId: grp.id,
        tenantId: collector.tenantId,
        ts: seenAt,
        release: e.release ?? null,
        environment: e.environment ?? null,
        userKey: e.userKey ?? null,
        // Which adapter produced this event — drives the by-source stats breakdown.
        source: e.source ?? null,
        payload: e as unknown as Record<string, unknown>,
        createdAt: now,
      });

      if (e.userKey) {
        // Dedupe key for this batch. The separator is a plain space: `grp.id` is a
        // fixed-format uuid that cannot contain one, so the first space is always
        // the delimiter and no two distinct pairs can collide. (It was a raw NUL
        // byte, which worked but made this whole FILE test as binary — ripgrep
        // skips such files, so nothing in here was findable by code search.)
        const k = `${grp.id} ${e.userKey}`;
        if (!userPairKeys.has(k)) { userPairKeys.add(k); userPairs.push({ groupId: grp.id, userKey: e.userKey }); }
      }
    } catch {
      dropped++;
    }
  }

  // QUAL-8 — the discard is recorded ON THE COLLECTOR, not only in the response
  // body. This is the ONLY durable trace an unroutable event leaves: the event
  // itself is never stored (there is no project to store it against), so without
  // this the operator's evidence is an HTTP 202 payload that no browser, SDK or
  // OTLP exporter surfaces. A collector quietly binning its whole stream and a
  // collector nobody is sending to look identical otherwise.
  //
  // Its own statement, outside the `eventRows.length` branch: a batch can be
  // 100% unroutable, which is precisely the case worth reporting and precisely
  // the case where no event row exists to hang the write off. Best-effort — a
  // failed counter must never fail an ingest.
  if (unmapped > 0 && collector.id != null) {
    await db
      .update(errorCollectors)
      .set({
        unmappedEventCount: sql`${errorCollectors.unmappedEventCount} + ${unmapped}`,
        lastUnmappedAt: now,
      })
      // Tenant-scoped even though the id is a uuid: the predicate is what makes
      // "this collector belongs to this tenant" checkable rather than assumed, and
      // `collector` arrives from a public ingest route.
      .where(scopedToTenant(errorCollectors, collector.tenantId, eq(errorCollectors.id, collector.id)))
      .catch((error) => {
        reportCaughtError(error, { source: 'application/quality/ingestEngine.ts', operation: 'ingestErrorEvents', context: { logMessage: '[quality-ingest] unmapped counter bump failed', details: { collectorId: collector.id, unmapped } } });
      });
  }

  if (eventRows.length > 0) {
    try {
      await db.insert(errorEvents).values(eventRows);
    } catch (error) {
      // The groups were already upserted; losing the raw event rows only affects
      // the meter/trend, never the dashboard's group view. Best-effort.
    
      reportCaughtError(error, { source: "application/quality/ingestEngine.ts", operation: "ingestErrorEvents" });
    }
    await bumpGroupUserCounts(db, collector.tenantId, userPairs, now);
    // A collector-less source (id: null — e.g. a manual "Report error") has no
    // collector row whose last-event timestamp to touch.
    if (collector.id != null) {
      await db.update(errorCollectors).set({ lastEventAt: now })
        .where(scopedToTenant(errorCollectors, collector.tenantId, eq(errorCollectors.id, collector.id)))
        .catch((error) => {
        reportCaughtError(error, { source: "application/quality/ingestEngine.ts", operation: "ingestErrorEvents" });
      });
    }
    for (const projectId of touchedProjects) await bumpCacheVersion(env, qualityGroupsVersionKey(projectId));
    await bumpCacheVersion(env, qualityGroupsTenantVersionKey(collector.tenantId));
  }

  return { accepted: eventRows.length, dropped, unmapped };
}

/**
 * Maintain the EXACT `error_groups.user_count`: record (group, user) pairs in the
 * set table and bump each group's count by the number of genuinely-new pairs (the
 * RETURNING rows). Idempotent — a repeat user contributes nothing. Best-effort:
 * a failure here only skews the affected-user count, never the error data itself.
 */
async function bumpGroupUserCounts(
  db: Db,
  tenantId: number,
  pairs: Array<{ groupId: string; userKey: string }>,
  now: Date,
): Promise<void> {
  if (pairs.length === 0) return;
  try {
    const inserted = await db
      .insert(errorGroupUsers)
      .values(pairs.map((p) => ({ groupId: p.groupId, userKey: p.userKey, firstSeen: now })))
      .onConflictDoNothing()
      .returning({ groupId: errorGroupUsers.groupId });

    const deltas = new Map<string, number>();
    for (const row of inserted) deltas.set(row.groupId, (deltas.get(row.groupId) ?? 0) + 1);

    for (const [groupId, delta] of deltas) {
      await db
        .update(errorGroups)
        .set({ userCount: sql`${errorGroups.userCount} + ${delta}` })
        .where(scopedToTenant(errorGroups, tenantId, eq(errorGroups.id, groupId)));
    }
  } catch (error) {
    // Affected-user count is non-critical; never fail the ingest over it.
  
    reportCaughtError(error, { source: "application/quality/ingestEngine.ts", operation: "bumpGroupUserCounts" });
  }
}

/** Parse an ISO/epoch timestamp tolerantly; null when unparseable. */
function parseTs(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
