/**
 * The `/demo` doors and the marketing funnel behind them.
 *
 *  - `demoEntryPath(persona)` says which surface a door opens on. It replaced
 *    `startDemoSession`, which minted a real short-lived session for one of five
 *    SEEDED SERVER TENANTS. Those tenants were shared, cost-capped and wiped by
 *    a nightly reseed — so a visitor's edits were destroyed by design at exactly
 *    the moment they had invested enough to care. There is one sample workspace
 *    now, it lives in the visitor's own guest session, and entering it is a
 *    navigation rather than a round trip that could fail on a per-IP counter.
 *  - `trackDemoEvent` / `queueDemoEvent` attach the persona to a journey event
 *    and hand it to `visitorJourney`, which records EVERY logged-out visitor's
 *    navigation. The demo's funnel is one persona-shaped slice of that, not its
 *    own stream — it used to be the only one, which is why the rest of the site
 *    was unmeasured.
 *  - `submitSalesLead` posts a "book a demo" / exit-intent lead. Lead capture is
 *    a different thing from the product demo and is untouched by any of this.
 *
 * The demo-mode CHROME went with the tenants: a banner saying "you are in a
 * demo" only ever activated when the authenticated tenant matched a minted demo
 * session, and there is no minted session to match. `<SampleDataNotice>` is its
 * honest replacement — it is mounted once by the shell, decides its own
 * visibility, and covers every surface rather than the five a tour knew about.
 */
import { apiRequestStream } from './apiClient';
import { getVisitorId } from './visitor';
import { flushVisitorEvents, queueVisitorEvent, trackVisitorEvent } from './visitorJourney';


export type DemoPersona = 'ai-team' | 'insights' | 'pmo' | 'talent' | 'governance';

export const DEMO_PERSONAS: DemoPersona[] = ['ai-team', 'insights', 'pmo', 'talent', 'governance'];

/**
 * Where each door on `/demo` lands.
 *
 * Five doors, ONE sample workspace behind them — which is the change. They used
 * to be five SEEDED SERVER TENANTS a visitor borrowed with a minted session:
 * shared, cost-capped, and wiped by a nightly reseed, so the visitor's edits
 * were destroyed by design at the exact moment they had invested enough to care.
 * Now a door is just the surface the sample workspace opens on, in the visitor's
 * OWN guest session — they edit it, it is theirs, and the boards they build are
 * claimed into their workspace when they sign up (`claimPendingDrafts`).
 *
 * The five cards stay because the five ENTRY POINTS are genuinely different
 * questions ("show me the team", "show me the numbers"), and their copy is
 * already written in five languages.
 */
const DEMO_ENTRY_PATHS: Record<DemoPersona, string> = {
  'ai-team': '/workforce',
  insights: '/insights',
  pmo: '/pmo',
  talent: '/workforce',
  governance: '/seat/governance',
};

/**
 * Enter the sample workspace through one of the `/demo` doors.
 *
 * No network call and nothing to fail: the guest session already exists (or is
 * minted on first read by `guestSessionStore`), the surfaces render for a
 * signed-out visitor, and the transport answers their reads from the sample
 * workspace. What used to be a round trip that could 429 on a per-IP counter is
 * now a navigation.
 */
export function demoEntryPath(persona: DemoPersona): string {
  return DEMO_ENTRY_PATHS[persona];
}

// ---------------------------------------------------------------------------
// Funnel telemetry.
//
// The demo's funnel is one persona-shaped slice of the SITE's journey, not a
// separate stream — so it records through `visitorJourney`, which owns the visit
// token, the batching and the endpoint. This file used to carry its own copy of
// all three, which is how the demo ended up as the only surface on the platform
// whose navigation was measured.
//
// These wrappers exist only to attach the persona; a caller that has no persona
// should use `visitorJourney` directly.
// ---------------------------------------------------------------------------

export interface DemoEventInput {
  kind: string;
  persona?: DemoPersona | null;
  path?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

/** Fire one demo funnel event immediately (best-effort). */
export function trackDemoEvent(event: DemoEventInput): void {
  trackVisitorEvent(event);
}

/** Queue a demo funnel event; flushed on the next flush or page hide. */
export function queueDemoEvent(event: DemoEventInput): void {
  queueVisitorEvent(event);
}

export const flushDemoEvents = flushVisitorEvents;

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
  // The locale header comes from the shared transport now — no per-call copy.
  const res = await apiRequestStream('/api/demo/leads', {
    method: 'POST',
    auth: 'none',
    body: JSON.stringify({ ...input, visitorId }),
    expectedErrors: [400, 429],
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.error ?? body.code ?? `lead_failed_${res.status}`);
  }
}
