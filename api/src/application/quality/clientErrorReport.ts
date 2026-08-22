/**
 * Client error reports — the ingest half of "a crash outside the Worker is still
 * OUR error".
 *
 * `agent-runtime` and the VS Code extension both caught errors and stopped: the
 * runtime wrote its own local log file, the extension wrote its output channel,
 * and neither had any path to the central store. The visible consequence was that
 * "why did this customer's on-prem agent fail" could only be answered by asking
 * them to send a log file.
 *
 * They are not browsers, so the keyed `/events` door does not fit — an ingest key
 * is a second credential to provision on every self-hosted machine. They already
 * hold one credential each (the agent host's API key; the extension's tenant JWT),
 * so the report is authenticated with THAT and the destination is derived here.
 *
 * This module owns the SHAPE and the DESTINATION only. Normalisation is the shared
 * `native` adapter's job and persistence is `ingestEngine`'s, exactly as for every
 * other channel — a client report must never become a second ingest pipeline.
 */

import { and, eq, isNull } from 'drizzle-orm';

import { errorCollectors, projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { CollectorRef } from './errorMapping';
import type { NormalizedErrorEvent } from './errorSpec';

/**
 * The surfaces allowed to file a client report, as DATA.
 *
 * A new reporting surface is a row here — never another branch in the route. The
 * `environment` is what separates on-prem noise from cloud noise in the Quality
 * feed, and the mapping rules of a tenant-level collector can route on it.
 */
export const CLIENT_REPORT_SOURCES = {
  'agent-runtime':     { environment: 'on-prem-runtime',  defaultType: 'AgentRuntimeError' },
  'vscode-extension':  { environment: 'vscode-extension', defaultType: 'ExtensionError' },
} as const satisfies Record<string, { environment: string; defaultType: string }>;

export type ClientReportSource = keyof typeof CLIENT_REPORT_SOURCES;

export function isClientReportSource(value: unknown): value is ClientReportSource {
  return typeof value === 'string' && value in CLIENT_REPORT_SOURCES;
}

/** How many events one request may carry. A crash loop must not become a flood. */
export const MAX_CLIENT_REPORT_EVENTS = 20;

export interface ParsedClientReport {
  source: ClientReportSource;
  /** The project the caller says the report belongs to; validated by the route. */
  projectId: number | null;
  events: NormalizedErrorEvent[];
}

const LEVELS = new Set<NormalizedErrorEvent['level']>(['fatal', 'error', 'warning', 'info']);

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Validate one inbound report body into canonical events.
 *
 * Returns a message instead of throwing, because every caller answers 400 with it
 * and an exception here would be reported as an API error of ours rather than a
 * malformed request of theirs.
 */
export function parseClientErrorReport(body: unknown): ParsedClientReport | { error: string } {
  const root = plainObject(body);
  if (!root) return { error: 'Body must be a JSON object' };
  if (!isClientReportSource(root.source)) {
    return { error: `source must be one of: ${Object.keys(CLIENT_REPORT_SOURCES).join(', ')}` };
  }
  const surface = CLIENT_REPORT_SOURCES[root.source];

  const rawEvents = Array.isArray(root.events) ? root.events : [];
  if (rawEvents.length === 0) return { error: 'events must be a non-empty array' };
  if (rawEvents.length > MAX_CLIENT_REPORT_EVENTS) {
    return { error: `events may contain at most ${MAX_CLIENT_REPORT_EVENTS} entries` };
  }

  const projectIdRaw = root.projectId;
  const projectId = typeof projectIdRaw === 'number' && Number.isInteger(projectIdRaw) && projectIdRaw > 0
    ? projectIdRaw
    : null;
  if (projectIdRaw != null && projectId == null) return { error: 'projectId must be a positive integer' };

  const events: NormalizedErrorEvent[] = [];
  for (const raw of rawEvents) {
    const entry = plainObject(raw);
    if (!entry) return { error: 'each event must be a JSON object' };
    const message = text(entry.message, 10_000);
    if (!message) return { error: 'each event needs a non-empty message' };
    const level = LEVELS.has(entry.level as NormalizedErrorEvent['level'])
      ? entry.level as NormalizedErrorEvent['level']
      : 'error';

    events.push({
      type: text(entry.type, 200) ?? surface.defaultType,
      message,
      level,
      timestamp: text(entry.timestamp, 40) ?? new Date().toISOString(),
      environment: surface.environment,
      source: 'native',
      ...(text(entry.stack, 20_000) ? { stack: text(entry.stack, 20_000) as string } : {}),
      ...(text(entry.release, 100) ? { release: text(entry.release, 100) as string } : {}),
      // `operation` is the runtime's equivalent of a URL: the seam it happened at.
      tags: {
        reporter: root.source,
        ...(text(entry.operation, 200) ? { service: text(entry.operation, 200) as string } : {}),
      },
      context: plainObject(entry.context) ?? {},
    });
  }

  return { source: root.source, projectId, events };
}

/**
 * Where a client report lands.
 *
 * 1. The project the caller named, when the tenant owns it — a linked workspace
 *    knows exactly which project its runtime serves.
 * 2. Otherwise the tenant's tenant-level collector, so an unlinked host's reports
 *    still route through the mapping rules the tenant already configured.
 *
 * `null` when neither resolves: a report with no destination is dropped silently
 * by the mapping resolver, and silently dropped is the failure this whole seam
 * exists to end. The route answers 422 and says so.
 */
export async function resolveClientReportCollector(
  db: Db,
  tenantId: number,
  projectId: number | null,
): Promise<CollectorRef | null> {
  if (projectId != null) {
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (owned) return { id: null, tenantId, projectId: owned.id, defaultProjectId: null };
  }

  const [collector] = await db
    .select({
      id: errorCollectors.id,
      defaultProjectId: errorCollectors.defaultProjectId,
      enabled: errorCollectors.enabled,
    })
    .from(errorCollectors)
    .where(and(
      eq(errorCollectors.tenantId, tenantId),
      isNull(errorCollectors.projectId),
      eq(errorCollectors.enabled, true),
    ))
    .limit(1);
  if (!collector) return null;

  return { id: collector.id, tenantId, projectId: null, defaultProjectId: collector.defaultProjectId };
}
