'use client';

/**
 * Where a logged-out visitor GOES — the ONE client-side journey recorder.
 *
 * `guestPromptCapture` is this module's sibling: it records what a visitor ASKED
 * FOR. Between the prompt and the eventual signup sat the entire experience —
 * the pages they moved through, the errors they hit, the moment they left,
 * whether they ever came back — and none of it was recorded outside the persona
 * demo. The signed-in activity tracker never fires for these visitors, so
 * without this the funnel had a first frame, a last frame, and nothing between.
 *
 * Fire-and-forget by construction: it never rejects, never blocks a navigation,
 * and flushes with `keepalive` so the last batch survives the page transition
 * that follows it by milliseconds — without that, the `visit_end` event would be
 * cancelled exactly when it matters most.
 */

import { apiRequestStream } from './apiClient';
import { getVisitorId } from './visitor';

/** The kinds with structural meaning to the flow graph. Mirrors
 *  `VISITOR_JOURNEY_KINDS` on the server; a surface may send any other kind and
 *  it still lands on the timeline. */
export const VISITOR_JOURNEY_KINDS = {
  visitStart: 'visit_start',
  pageView: 'page_view',
  error: 'error',
  visitEnd: 'visit_end',
} as const;

export interface VisitorEventInput {
  kind: string;
  path?: string;
  persona?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

const VISIT_KEY = 'bf_visit_id';
const VISIT_SEEN_KEY = 'bf_visit_last_seen';
const VISIT_COUNT_KEY = 'bf_visit_count';

/**
 * How long a visitor can be idle before their next event starts a NEW visit.
 *
 * Thirty minutes is the web-analytics convention, and the reason to keep it is
 * that it makes "came back" mean the same thing here as everywhere else the
 * operator has ever read a funnel. A tab left open overnight is two visits, not
 * one eighteen-hour session, which is the only reading that makes time-on-site
 * a usable number.
 */
const VISIT_IDLE_MS = 30 * 60 * 1000;

/** Flush at this depth rather than per event — a navigation-heavy visit should
 *  cost a handful of requests, not one per click. */
const FLUSH_AT = 10;

let queue: VisitorEventInput[] = [];

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode. A visit with no durable token is still worth recording; it
    // simply cannot be joined to the visitor's earlier ones.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode */ }
}

/** The visit in progress, minted on first call and rotated after an idle gap. */
export function getVisitId(): string | null {
  if (typeof window === 'undefined') return null;
  const now = Date.now();
  const lastSeen = Number(readStored(VISIT_SEEN_KEY) ?? '0');
  const existing = readStored(VISIT_KEY);
  const stale = !existing || !Number.isFinite(lastSeen) || now - lastSeen > VISIT_IDLE_MS;

  const visitId = stale ? randomToken() : existing;
  if (stale) {
    writeStored(VISIT_KEY, visitId);
    writeStored(VISIT_COUNT_KEY, String(visitCount() + 1));
  }
  writeStored(VISIT_SEEN_KEY, String(now));
  return visitId;
}

/** How many visits this browser has started, this one included. */
export function visitCount(): number {
  if (typeof window === 'undefined') return 0;
  const raw = Number(readStored(VISIT_COUNT_KEY) ?? '0');
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Have they been here before? The client half of "did they come back". */
export function isReturningVisitor(): boolean {
  return visitCount() > 1;
}

/** Queue one event; sent on the next flush or page hide. */
export function queueVisitorEvent(event: VisitorEventInput): void {
  queue.push({ ...event, occurredAt: event.occurredAt ?? new Date().toISOString() });
  if (queue.length >= FLUSH_AT) flushVisitorEvents();
}

/** Send one event now — for the ones whose moment is the point (a visit ending). */
export function trackVisitorEvent(event: VisitorEventInput): void {
  queueVisitorEvent(event);
  flushVisitorEvents();
}

/** Send whatever is queued. Safe to call when empty. */
export function flushVisitorEvents(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  void sendVisitorEvents(batch);
}

async function sendVisitorEvents(events: VisitorEventInput[]): Promise<void> {
  const visitorId = getVisitorId();
  const visitId = getVisitId();
  if (!visitorId || events.length === 0) return;
  try {
    await apiRequestStream('/api/visitor/events', {
      method: 'POST',
      auth: 'none',
      keepalive: true,
      body: JSON.stringify({
        visitorId,
        events: events.map((event) => ({ ...event, visitId })),
      }),
      // Fires on unload, and on marketing pages with no session. A failure here
      // must never raise the global error toast — which would itself file an
      // error report, which would be a report about failing to file reports.
      expectedErrors: [400, 401, 403, 404, 429, 500, 502, 503],
    });
  } catch {
    /* best-effort: telemetry never costs the visitor anything */
  }
}
