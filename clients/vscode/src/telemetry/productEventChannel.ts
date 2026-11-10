/**
 * The editor's named product events — the host-neutral core (no `vscode`, no transport), so it is tested on its own.
 * `productEvents.ts` binds it to the editor's telemetry setting, the session and the platform's span ingest.
 *
 * WHAT MAY LEAVE. Only an event NAME on {@link PRODUCT_EVENT_PROPS}, and only that event's allowlisted props, and only
 * values that are counts, codes or durations: a finite number, a boolean, or a short code-shaped string. A path, a snippet
 * or a secret has a `/`, a space or a length a code never has, so it is dropped rather than truncated.
 *
 * WHEN. Nothing is queued while the user has telemetry off or is signed out; a queued batch is checked again at send time
 * (telemetry may have been turned off since). Emitting never blocks and never throws into the caller.
 */

export type ProductEventValue = number | boolean | string;

/** One sanitized event, as queued. */
export interface ProductEvent {
  name: string;
  /** ISO time it was emitted. */
  at: string;
  props: Record<string, ProductEventValue>;
}

/**
 * The events the editor may send and, per event, the props that may ride with it. A name not listed here is not sent;
 * a prop not listed for its event is stripped. Adding an event is adding a row.
 */
export const PRODUCT_EVENT_PROPS: Readonly<Record<string, readonly string[]>> = {
  // PRD 41 §4 (WS7): counts and the headline, never content.
  "delta.computed": ["surface", "mode", "headline", "ms", "files", "excluded", "introduced", "resolved", "blocking"],
  // PRD 41 §4 (WS3): the background indexer's plan time and each level's time to ready, as counts and durations.
  "index.plan_ms": ["surface", "ms", "files", "changed"],
  "index.level_ready": ["surface", "level", "ms", "files"],
  // PRD 41 §4 (WS19): a prediction the card rendered — which model, its version and status, and its quantized value.
  "prediction.shown": ["surface", "prediction", "model", "version", "status", "value"],
  // PRD 41 §10 (WS20): the dynamic-tier scheduler against random scheduling — counts only (`scheduleTelemetry`).
  "delta.dynamic_scheduled": [
    "surface", "scheduled", "scheduledChanged", "explored", "exploredChanged", "exploredWouldRun", "exploredChangedWouldRun", "failed", "notScheduled",
    "budgetSkipped",
  ],
};

/** A code: an enum value or identifier, never a path, sentence or token. */
const CODE = /^[A-Za-z0-9_.:-]{1,40}$/;

const valueOf = (raw: unknown): ProductEventValue | undefined => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return CODE.test(raw) ? raw : undefined;
  return undefined;
};

/** The event as it may leave the machine, or undefined when its name is not allowlisted. */
export function sanitizeProductEvent(name: string, props: Readonly<Record<string, unknown>>, now: Date): ProductEvent | undefined {
  const allowed = Object.prototype.hasOwnProperty.call(PRODUCT_EVENT_PROPS, name) ? PRODUCT_EVENT_PROPS[name] : undefined;
  if (!allowed) return undefined;
  const out: Record<string, ProductEventValue> = {};
  for (const key of allowed) {
    const value = valueOf(props[key]);
    if (value !== undefined) out[key] = value;
  }
  return { name, at: now.toISOString(), props: out };
}

/** The span body `POST /api/telemetry/spans` takes for one product event. */
export interface ProductEventSpan {
  kind: string;
  ts: string;
  durationMs: number | null;
  agentRole: string;
  description: string;
  traceId: string;
}

/**
 * Product events as telemetry spans: the event name is the span `kind`, `ms` its duration, the rest of the (already
 * sanitized) props its description. `traceId` groups one editor session's events.
 */
export function productEventSpans(events: readonly ProductEvent[], traceId: string): ProductEventSpan[] {
  return events.map(({ name, at, props }) => {
    const { ms, ...rest } = props;
    return {
      kind: name,
      ts: at,
      durationMs: typeof ms === "number" ? Math.max(0, Math.round(ms)) : null,
      agentRole: "vscode",
      description: JSON.stringify(rest),
      traceId,
    };
  });
}

export interface ProductEventChannelDeps {
  /** The user's telemetry setting, read at emit time. */
  telemetryEnabled(): boolean;
  /** Is there a signed-in session to attribute the event to? */
  signedIn(): boolean;
  /** Queue one sanitized event (the batching outbox). */
  enqueue(event: ProductEvent): void;
  now?(): Date;
}

/** `emitProductEvent(name, props)` over the given deps: gated, sanitized, queued — and never throws. */
export function createProductEventChannel(deps: ProductEventChannelDeps): (name: string, props: Readonly<Record<string, unknown>>) => void {
  return (name, props) => {
    try {
      if (!deps.telemetryEnabled() || !deps.signedIn()) return;
      const event = sanitizeProductEvent(name, props, deps.now?.() ?? new Date());
      if (event) deps.enqueue(event);
    } catch {
      // Telemetry is best-effort: a failure here must never reach the run that emitted it.
    }
  };
}

/**
 * A batch sender that re-checks the telemetry setting at send time: a batch queued before the user turned telemetry off
 * is dropped (resolved, not failed) rather than sent.
 */
export function gatedSend<T>(telemetryEnabled: () => boolean, send: (batch: T[]) => Promise<void>): (batch: T[]) => Promise<void> {
  return async (batch) => {
    if (batch.length === 0 || !telemetryEnabled()) return;
    await send(batch);
  };
}
