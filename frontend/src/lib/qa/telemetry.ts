/**
 * Agentic QA — client usage capture.
 *
 * Records a lightweight, PII-redacted stream of interaction events (pageviews,
 * clicks, form submits, input *shape*) and batches them to POST /api/qa/events.
 * Those journeys are later aggregated into flows and fed to the test generator.
 *
 * Design constraints:
 *  - Capture must NEVER break the app: every public method is wrapped so a
 *    throw is swallowed.
 *  - No raw input values ever leave the browser — only a redacted descriptor
 *    (field name/type + value length). Password fields are skipped entirely.
 *  - Selectors are stable-first: data-testid → role+accessible-name → text →
 *    a short css path. This is what the generator turns into Playwright locators.
 *  - Gated by NEXT_PUBLIC_QA_CAPTURE === '1' and an authenticated tenant token;
 *    otherwise start() is a no-op.
 */

import { deriveSelector, redactInput } from '@builderforce/interaction-contract';
import { classifyQueue, createOutbox, isDurableUserWorkQueue, isTelemetryQueue } from '@builderforce/write-outbox';
import { getApiBaseUrl, getAuthHeaders, apiRequestStream } from '../apiClient';
import { AMBIENT_REQUEST_ERRORS } from '../errors/transportFailure';

export { deriveSelector };

export type QaEventType = 'pageview' | 'click' | 'input' | 'submit' | 'nav';

export interface QaCaptureEvent {
  seq: number;
  type: QaEventType;
  route?: string;
  selector?: string;
  label?: string;
  value?: string;
  meta?: Record<string, unknown>;
  ts: string;
}

const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 50;
const SESSION_KEY = 'bf_qa_session_id';
const QA_CAPTURE = 'qa-capture';
/** Named telemetry stays best-effort. Only durable user work would stamp history. */
const qaCaptureWork =
  isTelemetryQueue(QA_CAPTURE) && !isDurableUserWorkQueue(QA_CAPTURE)
    ? 'telemetry'
    : classifyQueue(QA_CAPTURE)?.retention === 'durable'
      ? 'history'
      : 'telemetry';

function isEnabled(): boolean {
  return process.env.NEXT_PUBLIC_QA_CAPTURE === '1';
}

/** One id per browser tab session — groups a continuous journey. */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s_${Date.now().toString(36)}`;
  }
}

/** A batch's project: a positive id, or null for the app shell. */
type QaProject = number | null;

/**
 * Send one project's batch. `final` (page unload) uses sendBeacon: it cannot set
 * Authorization, so it cannot go through the shared transport at all — a best-effort
 * last gasp. The timed flush is the reliable, authenticated path.
 */
function sendQaBatch(projectId: QaProject, events: QaCaptureEvent[], final: boolean): Promise<unknown> | void {
  const path = '/api/qa/events';
  const payload = JSON.stringify({
    sessionId: getSessionId(),
    ...(projectId !== null ? { projectId } : {}),
    events,
  });
  if (final && navigator.sendBeacon) {
    navigator.sendBeacon(`${getApiBaseUrl()}${path}`, new Blob([payload], { type: 'application/json' }));
    return;
  }
  return apiRequestStream(path, {
    method: 'POST',
    body: payload,
    keepalive: true,
    // Telemetry flush — best-effort, and fires on unload.
    expectedErrors: AMBIENT_REQUEST_ERRORS,
  });
}

class QaCapture {
  /**
   * One lane per project, so a batch is never split across two attributions and a
   * project switch needs no flush of its own. Batches leave at {@link MAX_QUEUE} or
   * every {@link FLUSH_INTERVAL_MS}, in order; a failure is dropped (best-effort).
   */
  private outbox = createOutbox<QaCaptureEvent, QaProject>({
    work: qaCaptureWork,
    maxItems: MAX_QUEUE,
    maxWaitMs: FLUSH_INTERVAL_MS,
    send: (projectId, events, ctx) => sendQaBatch(projectId, events, ctx.final),
  });
  private seq = 0;
  /**
   * The project these interactions belong to, or null for "the app shell", which
   * belongs to no customer project. Sent with every batch so QA heat can be
   * ranked per project (0955) instead of pooled across the whole workspace —
   * without it, the tester planned one product's exploration from another
   * product's traffic. Null is the honest default and the meaning every
   * pre-0955 row carries.
   */
  private projectId: number | null = null;
  private started = false;
  private onClick = (e: Event) => this.handleClick(e);
  private onSubmit = (e: Event) => this.handleSubmit(e);
  private onChange = (e: Event) => this.handleChange(e);
  private onUnload = () => this.flush(true);

  start(): void {
    if (this.started || typeof window === 'undefined' || !isEnabled()) return;
    // Only capture when authenticated — getAuthHeaders carries the tenant token.
    if (!getAuthHeaders().Authorization) return;
    this.started = true;
    document.addEventListener('click', this.onClick, { capture: true });
    document.addEventListener('submit', this.onSubmit, { capture: true });
    document.addEventListener('change', this.onChange, { capture: true });
    window.addEventListener('pagehide', this.onUnload);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    document.removeEventListener('click', this.onClick, { capture: true } as EventListenerOptions);
    document.removeEventListener('submit', this.onSubmit, { capture: true } as EventListenerOptions);
    document.removeEventListener('change', this.onChange, { capture: true } as EventListenerOptions);
    window.removeEventListener('pagehide', this.onUnload);
    this.flush(true);
  }

  /** Attribute subsequent events to a project (or null for the app shell). */
  setProject(projectId: number | null): void {
    this.projectId = projectId != null && Number.isInteger(projectId) && projectId > 0 ? projectId : null;
  }

  /** Emit a pageview — call on every route change. */
  pageview(route: string): void {
    this.push({ type: 'pageview', route, ts: new Date().toISOString() });
  }

  private push(ev: Omit<QaCaptureEvent, 'seq'>): void {
    try {
      this.outbox.enqueue(this.projectId, { ...ev, seq: this.seq++ });
    } catch {
      /* capture must never throw */
    }
  }

  private handleClick(e: Event): void {
    try {
      const target = e.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      // Walk to the nearest meaningful interactive ancestor.
      const el = (target.closest('a,button,[role],[data-testid],input,select') ?? target) as Element;
      const { selector, label } = deriveSelector(el);
      this.push({
        type: 'click', selector, label,
        route: window.location.pathname,
        meta: { tag: el.tagName.toLowerCase() },
        ts: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }

  private handleSubmit(e: Event): void {
    try {
      const form = e.target as Element | null;
      if (!form) return;
      const { selector, label } = deriveSelector(form);
      this.push({ type: 'submit', selector, label, route: window.location.pathname, ts: new Date().toISOString() });
    } catch {
      /* ignore */
    }
  }

  private handleChange(e: Event): void {
    try {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      const value = el.tagName === 'SELECT' ? 'select:changed' : redactInput(el as HTMLInputElement);
      if (value === null) return; // password — skip
      const { selector, label } = deriveSelector(el);
      this.push({ type: 'input', selector, label, value, route: window.location.pathname, ts: new Date().toISOString() });
    } catch {
      /* ignore */
    }
  }

  /** Send every queued batch. `beacon` = the page is unloading (see {@link sendQaBatch}). */
  flush(beacon = false): void {
    void this.outbox.flush(undefined, { final: beacon });
  }
}

export const qaCapture = new QaCapture();
