/**
 * Builderforce's `SecurityEventSink` for the browser runtime's Security Shield (make.md ›
 * PRD 31 §4 W10, design decision 9): the events that STOPPED something (action `reject` or
 * `quarantine`) go to `POST /api/security/shield-incidents`, where the server decides — from
 * the reason code alone — whether one becomes an incident. Probes (`monitor`, `throttle`,
 * `allow`) stay in the runtime's own ring.
 *
 * The runtime calls `emit` synchronously and never awaits it, so this:
 * - never throws and never blocks (a failed report is dropped; enforcement never depends on it);
 * - deduplicates per (reason code, application) per minute — a refusal in a loop is one report;
 * - batches: reports leave together shortly after the first, bounded per batch.
 *
 * The API's ids allow `[\w.@/-]` only (they become part of the incident's `shield:` ref, where
 * `:` separates), so the runtime's `app:<projectId>:<hex>` application id is sent with `.` for `:`.
 */
import type { SecurityEvent, SecurityEventSink } from '@seanhogg/builderforce-webcontainers';
import { recordedFailure } from '@/lib/reportError';
import { runtimeSecurityApi, type ShieldIncidentReport } from './runtimeSecurityApi';

/** One report per (reason code, application) per this window. */
export const SHIELD_DEDUPE_WINDOW_MS = 60_000;
/** How long the first event of a batch waits for others. */
export const SHIELD_BATCH_DELAY_MS = 2_000;
/** Reports per batch; the rest of a burst is dropped (the server dedupes per rule anyway). */
export const SHIELD_BATCH_MAX = 20;

const REPORTED_ACTIONS = new Set<SecurityEvent['action']>(['reject', 'quarantine']);
/** `app:<projectId>:<16 hex>`, the runtime's application id. */
const APPLICATION_ID = /^app:(\d+):[0-9a-f]+$/;

export interface ShieldSinkOptions {
  /** The project the runtime runs (its id), for events not owned by an application. */
  projectId: () => string | null;
  report?: (report: ShieldIncidentReport) => Promise<void>;
  now?: () => number;
  schedule?: (flush: () => void, ms: number) => void;
}

/** An id as the API accepts it: `:` → `.`, anything else outside `[\w.@/-]` → `_`, at most 128. */
export function shieldId(raw: string): string {
  const id = raw.replace(/:/g, '.').replace(/[^\w.@/-]/g, '_').slice(0, 128);
  return id || 'unattributed';
}

function projectOf(applicationId: string, fallback: string | null): number | null {
  const owned = APPLICATION_ID.exec(applicationId)?.[1] ?? fallback;
  const id = Number(owned);
  return owned && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The body the API takes for `event`, or null when it cannot be attributed to a project. */
export function shieldReportOf(event: SecurityEvent, fallbackProjectId: string | null): ShieldIncidentReport | null {
  const projectId = projectOf(event.context.applicationId, fallbackProjectId);
  if (projectId === null) return null;
  return {
    category: event.category,
    ruleId: shieldId(event.ruleId),
    severity: event.severity,
    reasonCode: event.reasonCode,
    action: event.action,
    applicationId: shieldId(event.context.applicationId),
    serviceId: shieldId(event.context.serviceId),
    projectId,
    evidence: { ...event.evidence },
    occurredAt: new Date(event.occurredAt).toISOString(),
  };
}

export function createShieldSink(options: ShieldSinkOptions): SecurityEventSink {
  const report = options.report ?? runtimeSecurityApi.reportShieldIncident;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((flush, ms) => { setTimeout(flush, ms); });
  const lastReported = new Map<string, number>();
  let batch: ShieldIncidentReport[] = [];

  const flush = () => {
    const sending = batch;
    batch = [];
    for (const body of sending) void report(body).catch(recordedFailure('Reporting a shield event', undefined));
    const horizon = now() - SHIELD_DEDUPE_WINDOW_MS;
    for (const [key, at] of lastReported) if (at <= horizon) lastReported.delete(key);
  };

  return {
    emit(event) {
      try {
        if (!REPORTED_ACTIONS.has(event.action)) return;
        const key = `${event.reasonCode}\u0000${event.context.applicationId}`;
        const at = now();
        const last = lastReported.get(key);
        if (last !== undefined && at - last < SHIELD_DEDUPE_WINDOW_MS) return;
        const body = shieldReportOf(event, options.projectId());
        if (!body || batch.length >= SHIELD_BATCH_MAX) return;
        lastReported.set(key, at);
        batch.push(body);
        if (batch.length === 1) schedule(flush, SHIELD_BATCH_DELAY_MS);
      } catch (error) {
        // Telemetry fails open (the shield already decided): recorded, never thrown.
        recordedFailure('Reading a shield event', undefined)(error);
      }
    },
  };
}
