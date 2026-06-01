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

import { getApiBaseUrl, getAuthHeaders } from '../apiClient';

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

/** Accessible name for an element: aria-label → trimmed text → title/placeholder. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, 120);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 120);
  const title = el.getAttribute('title') ?? el.getAttribute('placeholder');
  return (title ?? '').trim().slice(0, 120);
}

/** Short, mostly-stable css path as a last resort. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 4 && node.nodeType === 1) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break;
    }
    const cls = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ').slice(0, 400);
}

/**
 * Derive a stable selector for an element, preferring locators Playwright can
 * reproduce. Returns a Playwright-style locator string.
 */
export function deriveSelector(el: Element): { selector: string; label: string } {
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test-id');
  if (testId) return { selector: `getByTestId(${JSON.stringify(testId)})`, label: testId };

  const role = el.getAttribute('role') ?? implicitRole(el);
  const name = accessibleName(el);
  if (role && name) return { selector: `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`, label: name };
  if (name) return { selector: `getByText(${JSON.stringify(name)})`, label: name };

  return { selector: cssPath(el), label: el.tagName.toLowerCase() };
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return null;
}

/** Redacted descriptor for an input — NEVER the raw value. */
function redactInput(el: HTMLInputElement | HTMLTextAreaElement): string | null {
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'password') return null; // never record password interactions
  const name = el.getAttribute('name') ?? el.getAttribute('id') ?? type;
  const len = (el.value ?? '').length;
  return `${name}:${type}:len${len}`.slice(0, 120);
}

class QaCapture {
  private queue: QaCaptureEvent[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
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
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    document.removeEventListener('click', this.onClick, { capture: true } as EventListenerOptions);
    document.removeEventListener('submit', this.onSubmit, { capture: true } as EventListenerOptions);
    document.removeEventListener('change', this.onChange, { capture: true } as EventListenerOptions);
    window.removeEventListener('pagehide', this.onUnload);
    if (this.timer) clearInterval(this.timer);
    this.flush(true);
  }

  /** Emit a pageview — call on every route change. */
  pageview(route: string): void {
    this.push({ type: 'pageview', route, ts: new Date().toISOString() });
  }

  private push(ev: Omit<QaCaptureEvent, 'seq'>): void {
    try {
      this.queue.push({ ...ev, seq: this.seq++ });
      if (this.queue.length >= MAX_QUEUE) this.flush();
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

  /** Send the queued batch. `beacon` uses sendBeacon for unload reliability. */
  flush(beacon = false): void {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    const url = `${getApiBaseUrl()}/api/qa/events`;
    const payload = JSON.stringify({ sessionId: getSessionId(), events: batch });
    try {
      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      if (beacon && navigator.sendBeacon) {
        // sendBeacon can't set Authorization; only use it as a best-effort
        // last gasp. The interval flush (below) is the reliable path.
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
        return;
      }
      void fetch(url, { method: 'POST', headers, body: payload, keepalive: true }).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export const qaCapture = new QaCapture();
