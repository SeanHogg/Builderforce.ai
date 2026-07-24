/**
 * Sales-cycle demo accounts (migration 0360) — client for the public demo API.
 *
 *  - `startDemoSession(persona)` mints a real (short-lived) session for the
 *    seeded persona demo tenant, persists it, and returns the in-app entry path.
 *    The caller does a full-page navigation there so AuthProvider rehydrates the
 *    signed-in session from localStorage (same pattern as the OAuth return).
 *  - `trackDemoEvents` / `queueDemoEvent` batch anonymous funnel telemetry keyed
 *    by the marketing visitorId (the signed-in activity tracker never fires for
 *    logged-out visitors — this is its marketing twin).
 *  - `submitSalesLead` posts a "book a demo" / exit-intent lead.
 *
 * Demo mode is remembered in sessionStorage so the DemoModeProvider can show the
 * banner + convert/exit prompts for the duration of the visit.
 */
import { AUTH_API_URL, persistSession } from './auth';
import type { AuthUser, Tenant } from './types';
import { getVisitorId } from './visitor';
import { readLocaleCookie } from '@/i18n/config';

export type DemoPersona = 'ai-team' | 'insights' | 'pmo' | 'talent' | 'governance';

export const DEMO_PERSONAS: DemoPersona[] = ['ai-team', 'insights', 'pmo', 'talent', 'governance'];

const DEMO_MODE_KEY = 'bf_demo_mode';
const EXIT_PROMPTED_KEY = 'bf_demo_exit_prompted';
const TOUR_SEEN_KEY = 'bf_demo_tour_seen';

export interface DemoSessionState {
  persona: DemoPersona;
  tenantName: string;
  startedAt: number;
}

interface DemoSessionResponse {
  persona: DemoPersona;
  entryPath: string;
  webToken: string;
  tenantToken: string;
  user: AuthUser & { username?: string; displayName?: string; avatarUrl?: string | null };
  tenant: { id: number; name: string; slug: string; role: string; plan: string };
}

export function getDemoState(): DemoSessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DEMO_MODE_KEY);
    return raw ? (JSON.parse(raw) as DemoSessionState) : null;
  } catch {
    return null;
  }
}

function setDemoState(state: DemoSessionState): void {
  try {
    sessionStorage.setItem(DEMO_MODE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function clearDemoMode(): void {
  try {
    sessionStorage.removeItem(DEMO_MODE_KEY);
    sessionStorage.removeItem(EXIT_PROMPTED_KEY);
    sessionStorage.removeItem(TOUR_SEEN_KEY);
  } catch {
    /* ignore */
  }
}

export function hasExitPrompted(): boolean {
  try {
    return sessionStorage.getItem(EXIT_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the product tour has already run (or been dismissed) this session. */
export function hasTourSeen(): boolean {
  try {
    return sessionStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    sessionStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function markExitPrompted(): void {
  try {
    sessionStorage.setItem(EXIT_PROMPTED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Enter a persona demo. Mints + persists the session and returns the entry path.
 * Throws on failure so the caller can surface an error.
 */
export async function startDemoSession(persona: DemoPersona): Promise<{ entryPath: string }> {
  const visitorId = getVisitorId();
  const res = await fetch(`${AUTH_API_URL}/api/demo/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona, visitorId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    throw new Error(body.code ?? body.error ?? `demo_session_failed_${res.status}`);
  }
  const data = (await res.json()) as DemoSessionResponse;

  const user: AuthUser = {
    id: data.user.id,
    email: data.user.email,
    name: data.user.displayName ?? data.user.username ?? data.user.email,
    isSuperadmin: false,
    accountType: 'standard',
    accountTypeSelected: true,
  };
  const tenant: Tenant = {
    id: String(data.tenant.id),
    name: data.tenant.name,
    slug: data.tenant.slug,
    role: data.tenant.role,
  };
  persistSession(data.webToken, user, data.tenantToken, tenant);
  setDemoState({ persona: data.persona, tenantName: data.tenant.name, startedAt: Date.now() });

  return { entryPath: data.entryPath };
}

// ---------------------------------------------------------------------------
// Funnel telemetry — small batched, best-effort, keyed by visitorId.
// ---------------------------------------------------------------------------

export interface DemoEventInput {
  kind: string;
  persona?: DemoPersona | null;
  path?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

let queue: DemoEventInput[] = [];

/** Fire one funnel event immediately (best-effort). */
export function trackDemoEvent(event: DemoEventInput): void {
  void trackDemoEvents([{ ...event, occurredAt: event.occurredAt ?? new Date().toISOString() }]);
}

/** Queue an event; flushed on the next flushDemoEvents() or page hide. */
export function queueDemoEvent(event: DemoEventInput): void {
  queue.push({ ...event, occurredAt: event.occurredAt ?? new Date().toISOString() });
  if (queue.length >= 10) void flushDemoEvents();
}

export function flushDemoEvents(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  void trackDemoEvents(batch);
}

export async function trackDemoEvents(events: DemoEventInput[]): Promise<void> {
  if (events.length === 0) return;
  const visitorId = getVisitorId();
  if (!visitorId) return;
  try {
    await fetch(`${AUTH_API_URL}/api/demo/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, events }),
      keepalive: true,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Book-a-demo / sales lead capture.
// ---------------------------------------------------------------------------

export interface SalesLeadInput {
  name: string;
  email: string;
  company?: string;
  interest?: string;
  message?: string;
  source: string;
}

export async function submitSalesLead(input: SalesLeadInput): Promise<void> {
  const visitorId = getVisitorId();
  const res = await fetch(`${AUTH_API_URL}/api/demo/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Builderforce-Locale': readLocaleCookie() ?? 'en',
    },
    body: JSON.stringify({ ...input, visitorId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.error ?? body.code ?? `lead_failed_${res.status}`);
  }
}
