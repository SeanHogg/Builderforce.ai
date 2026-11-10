/**
 * The editor's named product-event channel (PRD 41 §4: "emitted through the existing telemetry, `surface` per host").
 *
 * There is no separate product-analytics backend: events go to the platform's existing span ingest,
 * `POST /api/telemetry/spans` (tenant JWT, tenant-attributed, retention-swept with the other telemetry relations), one
 * span per event — the name is the span kind. Not `/api/activity/ingest`: activity signals resolve into BILLABLE time,
 * and a product event must never bill anyone.
 *
 * Gating and sanitizing live in `productEventChannel.ts`. Here: the user's telemetry setting (`vscode.env.isTelemetryEnabled`,
 * which also honours the editor-wide `telemetry.telemetryLevel`), the signed-in session, and a best-effort queue on the
 * extension's shared outbox — batched, scoped to the workspace it was emitted in, behind the platform send permission,
 * paused while the API is unreachable, and DROPPED (never retried, never dead-lettered) when a send fails.
 */

import * as vscode from "vscode";
import { signedInTenantId } from "../bfApi/session";
import { authedRaw } from "../bfApi/transport";
import { createDurableOutbox, outboxSecrets, scopeTenantId } from "../outboxStorage";
import { createProductEventChannel, gatedSend, productEventSpans, type ProductEvent } from "./productEventChannel";

const SPANS_PATH = "/api/telemetry/spans";
const STREAM = "vsix";

const telemetryEnabled = (): boolean => vscode.env.isTelemetryEnabled;

async function postSpans(batch: ProductEvent[], asTenant: number | undefined): Promise<void> {
  const r = await authedRaw<unknown>(await outboxSecrets(), SPANS_PATH, {
    method: "POST",
    body: JSON.stringify(productEventSpans(batch, vscode.env.sessionId)),
    asTenant,
  });
  if (r.status >= 400) throw Object.assign(new Error(`${SPANS_PATH} → HTTP ${r.status}`), { status: r.status });
}

const events = createDurableOutbox<ProductEvent>("product-events", {
  work: "telemetry",
  onFailure: "drop-on-failure",
  maxItems: 25,
  maxWaitMs: 5 * 60_000,
  maxEntries: 500,
  send: (_stream, batch, ctx) => gatedSend<ProductEvent>(telemetryEnabled, (b) => postSpans(b, scopeTenantId(ctx.scope)))(batch),
});

/**
 * Emit one named product event. Dropped when telemetry is off, the user is signed out, or the name is not allowlisted;
 * props are reduced to the event's allowlisted counts, codes and durations. Never blocks, never throws.
 */
export const emitProductEvent: (name: string, props: Readonly<Record<string, unknown>>) => void = createProductEventChannel({
  telemetryEnabled,
  signedIn: () => signedInTenantId() !== undefined,
  enqueue: (event) => {
    events.enqueue(STREAM, event);
  },
});
