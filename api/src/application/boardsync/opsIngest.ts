/**
 * Ops-event ingest — route `incident`-category connector webhooks (Sentry,
 * PagerDuty) into prod_incidents (the Quality lens) instead of the task board.
 * An incident is NOT a kanban ticket, so it must not reconcile into tasks; this
 * is the seam that diverts it. Upsert is keyed by (tenant, source, external_ref)
 * to match the migration's unique index, so a re-fired webhook updates in place.
 *
 * ITSM-category providers (Freshservice/ServiceNow) are poll-only and route to
 * support_tickets via the poll sweep — tracked as a follow-up; manual CRUD on
 * /api/insights/quality/support-tickets works today.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { prodIncidents } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { qualityVersionKey } from '../insights/versionKeys';
import type { NormalizedWebhookTicket } from './webhookIngest';

/** Map a provider state string onto our incident status vocabulary. */
function mapStatus(provider: string, state: string): string {
  const s = (state || '').toLowerCase();
  if (['resolved', 'closed', 'fixed'].includes(s)) return 'resolved';
  if (['acknowledged', 'ack'].includes(s)) return 'acknowledged';
  if (['mitigated'].includes(s)) return 'mitigated';
  return 'open';
}

/** A PagerDuty trigger pages but may never become an incident; treat a still-open
 *  low-signal alert as alert-only until it is acknowledged/resolved. */
function isAlertOnly(provider: string, state: string): boolean {
  return provider === 'pagerduty' && (state || '').toLowerCase() === 'triggered';
}

/**
 * Upsert a normalized incident webhook into prod_incidents and refresh the
 * Quality lens cache. Returns the written row id. Tenant/segment come from the
 * connection, never the request.
 */
export async function ingestIncidentWebhook(
  db: Db,
  env: Env,
  conn: { tenantId: number; segmentId: string | null; projectId: number | null },
  provider: string,
  normalized: NormalizedWebhookTicket,
): Promise<string> {
  const status = mapStatus(provider, normalized.state);
  const resolvedAt = status === 'resolved' ? new Date() : null;
  const startedAt = normalized.externalVersion ? new Date(normalized.externalVersion) : new Date();

  const values = {
    tenantId: conn.tenantId,
    segmentId: conn.segmentId,
    projectId: conn.projectId,
    title: normalized.title || `${provider} incident ${normalized.externalId}`,
    status,
    isAlertOnly: isAlertOnly(provider, normalized.state),
    source: provider,
    externalRef: normalized.externalId,
    startedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
    resolvedAt,
    impact: normalized.body ?? null,
    postmortemUrl: normalized.externalUrl ?? null,
    updatedAt: new Date(),
  };

  const rows = (await db
    .insert(prodIncidents)
    .values(values)
    .onConflictDoUpdate({
      target: [prodIncidents.tenantId, prodIncidents.source, prodIncidents.externalRef],
      set: { status: values.status, resolvedAt: values.resolvedAt, isAlertOnly: values.isAlertOnly, impact: values.impact, updatedAt: values.updatedAt },
    })
    .returning({ id: prodIncidents.id })) as Array<{ id: string }>;

  await bumpCacheVersion(env, qualityVersionKey(conn.tenantId));
  return rows[0]?.id ?? '';
}
