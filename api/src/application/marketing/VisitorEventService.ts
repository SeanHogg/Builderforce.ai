import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { visitorEvents } from '../../infrastructure/database/schema';
import {
  VISITOR_EVENT_LIMITS,
  parseVisitorEvent,
  type VisitorEvent,
} from '../../domain/marketing/VisitorJourney';
import { isDemoPersona } from '../demo/demoPersonas';
import { isValidVisitorId } from './MarketingService';

/**
 * The ONE write path into the anonymous visitor journey.
 *
 * Three surfaces record into this stream and they must not each own a copy of
 * "what a valid event is": the site-wide journey tracker (every logged-out
 * navigation), the persona demo (its own funnel vocabulary), and the error
 * reporter (an anonymous crash, which is the fact that was missing from this
 * stream entirely). Validation lives in the domain, the abuse ceiling and the
 * insert live here, and no route parses an event itself.
 *
 * Every write is best-effort by contract. This is telemetry attached to a
 * visitor's real work — a failed insert must never fail their request, and the
 * unload-path batch in particular has nobody left to report an error to.
 */

export interface VisitorEventInput {
  kind?: unknown;
  visitId?: unknown;
  persona?: unknown;
  path?: unknown;
  metadata?: unknown;
  occurredAt?: unknown;
}

export type VisitorEventRejection = 'invalid_visitor' | 'rate_limited';

export type VisitorEventResult =
  | { ok: true; accepted: number }
  | { ok: false; reason: VisitorEventRejection };

/** Per-IP daily ceiling, in KV. Fails OPEN: losing telemetry beats losing a page. */
const IP_DAILY_EVENT_LIMIT = 2_000;

/**
 * Validate and persist a batch.
 *
 * The batch is truncated rather than rejected when it is over the cap: a client
 * that queued too much on a slow connection should lose the tail, not the whole
 * visit.
 */
export async function recordVisitorEvents(
  db: Db,
  env: Env,
  input: { visitorId: unknown; ip: string | null; events: VisitorEventInput[] },
): Promise<VisitorEventResult> {
  if (!isValidVisitorId(input.visitorId)) return { ok: false, reason: 'invalid_visitor' };
  const visitorId = input.visitorId;

  const nowMs = Date.now();
  const rows = input.events
    .slice(0, VISITOR_EVENT_LIMITS.maxPerBatch)
    .map((event) => parseVisitorEvent(event, { visitorId, personaOf, nowMs }))
    .filter((row): row is VisitorEvent => row !== null);

  if (rows.length === 0) return { ok: true, accepted: 0 };
  if (!(await withinIpBudget(env, input.ip, rows.length))) return { ok: false, reason: 'rate_limited' };

  await db.insert(visitorEvents).values(rows);
  return { ok: true, accepted: rows.length };
}

/**
 * Record one event the server itself observed.
 *
 * Used where the browser is not the one that knows: a demo session starting, and
 * an error arriving at the Product Quality ingest. Both already hold a validated
 * visitor id, so this skips the IP ceiling — it is not an open write path.
 */
export async function recordVisitorEvent(
  db: Db,
  event: { visitorId: string } & VisitorEventInput,
): Promise<void> {
  const row = parseVisitorEvent(event, {
    visitorId: event.visitorId,
    personaOf,
    nowMs: Date.now(),
  });
  if (!row) return;
  await db.insert(visitorEvents).values(row);
}

function personaOf(value: unknown): string | null {
  return isDemoPersona(value) ? value : null;
}

async function withinIpBudget(env: Env, ip: string | null, weight: number): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv || !ip) return true;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `visitor:events:ip:${day}:${ip}`;
  try {
    const current = Number((await kv.get(key)) ?? '0');
    if (current >= IP_DAILY_EVENT_LIMIT) return false;
    await kv.put(key, String(current + weight), { expirationTtl: 86_400 });
  } catch {
    // KV is unavailable, not hostile. Dropping real telemetry to protect a
    // counter would be the wrong trade.
    return true;
  }
  return true;
}
