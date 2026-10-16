import * as vscode from "vscode";

import { authedRaw } from "./bfApi";
import { createDurableOutbox, outboxSecrets, scopeTenantId } from "./outboxStorage";
import { getSelectedProject } from "./projectState";

/**
 * The extension's ONE log surface, and its OPT-IN path to the platform's error store.
 *
 * ## Why it exists
 *
 * Every caught error in this extension used to end at the output channel, which is
 * visible to exactly one person: whoever it happened to. Nothing reached the
 * central store, so a crash in a customer's editor was invisible to the platform
 * unless they thought to copy the panel out and send it.
 *
 * ## What the contract is
 *
 * The output channel stays the contract. It always gets the line, it is always
 * complete, and nothing leaves the machine unless the user turns on
 * `builderforce.reportErrors` (default off). With it on, the same errors are also
 * filed against the selected project in Quality, using the credential the user is
 * already signed in with.
 *
 * The channel is owned here rather than created in `extension.ts` so that any
 * module can log without being handed one, and so that "log it" and "file it" can
 * never drift apart.
 *
 * Filing goes through the durable write outbox: a report raised while offline (often
 * BECAUSE the editor is offline) is kept and filed once the platform answers again,
 * under its own `Idempotency-Key`, so a replay never files the same error twice. This
 * is the same door — `POST /api/quality-ingest/client-report` — every signed-in client
 * (agent-runtime, the browser extension) reports through.
 */

/** The setting a user flips to allow error reports to leave the machine. */
const SETTING_SECTION = "builderforce";
const SETTING_KEY = "reportErrors";

let channel: vscode.OutputChannel | undefined;

/**
 * Create the output channel. Call once from `activate`; returns the channel for callers
 * that want to show it. Reports are sent with the credential bound for the durable
 * outboxes (`bindOutboxStorage`, also in `activate`).
 */
export function initErrorReporter(context: vscode.ExtensionContext): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("BuilderForce");
  context.subscriptions.push(channel);
  return channel;
}

/** Append one line to the BuilderForce output channel. Safe before activation. */
export function logLine(message: string): void {
  channel?.appendLine(message);
}

/** Has the user allowed error reports to leave this machine? */
export function isErrorReportingEnabled(): boolean {
  return vscode.workspace.getConfiguration(SETTING_SECTION).get<boolean>(SETTING_KEY, false);
}

/**
 * The ONE way this extension surfaces a caught error: tell the user, and file it.
 *
 * Every command used to do half of this - `showErrorMessage(...)` and nothing else -
 * so the message the user saw was the only record that anything had gone wrong.
 * Pairing the two here is what stops the next command from repeating that.
 */
export function surfaceError(error: unknown, operation: string, userMessage: string): void {
  void reportExtensionError(error, { operation });
  void vscode.window.showErrorMessage(userMessage);
}

export interface ExtensionErrorDetails {
  /** The seam it happened at, e.g. `command:builderforce.dispatch`. */
  operation: string;
  /** Structured detail stored verbatim on the event. Keep it small and non-secret. */
  context?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning";
}

/** One error event as `POST /api/quality-ingest/client-report` takes it. */
interface ClientErrorEvent {
  type: string;
  message: string;
  stack: string | null;
  level: "fatal" | "error" | "warning";
  operation: string;
  release?: string;
  timestamp: string;
  context: Record<string, unknown>;
}

/** Lane key: the destination project ("" = the workspace's default collector). */
const laneOf = (projectId: number | null): string => (projectId == null ? "" : String(projectId));

/**
 * Queued reports, one lane per destination project, filed in batches. A 5xx or no answer
 * is retried; 422 (no destination project) and 429 (the workspace hit its monthly event
 * cap) are settled outcomes the user can act on, so they are logged and NOT retried.
 */
const reports = createDurableOutbox<ClientErrorEvent>("error-reports", {
  // The door takes at most 20 events a request (`MAX_CLIENT_REPORT_EVENTS`).
  maxItems: 20,
  maxWaitMs: 2_000,
  maxEntries: 200,
  send: async (lane, events, ctx) => {
    const result = await authedRaw<{ error?: string }>(await outboxSecrets(), "/api/quality-ingest/client-report", {
      method: "POST",
      headers: { "Idempotency-Key": ctx.idempotencyKey },
      body: JSON.stringify({ source: "vscode-extension", projectId: lane === "" ? null : Number(lane), events }),
      // Filed AS the workspace the error happened in — never into another.
      asTenant: scopeTenantId(ctx.scope),
    });
    if (result.status >= 500 || result.status === 401) {
      throw Object.assign(new Error(`HTTP ${result.status}`), { status: result.status });
    }
    if (result.status >= 400) {
      logLine(`  (report not filed: HTTP ${result.status}${result.body?.error ? ` ${result.body.error}` : ""})`);
    }
  },
  onError: (error) => logLine(`  (report not filed yet, will retry: ${String(error)})`),
});

/**
 * Log a caught error to the output channel, and — when reporting is on — queue it for
 * the platform's error store (filed against the selected project, or the workspace's
 * default collector).
 *
 * Never throws and never shows a notification: a reporting failure must not become
 * the thing the user sees instead of the error they actually hit.
 */
export async function reportExtensionError(
  error: unknown,
  details: ExtensionErrorDetails,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logLine(`[${details.operation}] ${message}`);

  if (!isErrorReportingEnabled()) return;

  reports.enqueue(laneOf(getSelectedProject()?.id ?? null), {
    type: error instanceof Error ? error.name : "ExtensionError",
    message,
    stack: error instanceof Error ? error.stack ?? null : null,
    level: details.level ?? "error",
    operation: details.operation,
    release: vscode.extensions.getExtension("builderforce.builderforce")?.packageJSON?.version,
    timestamp: new Date().toISOString(),
    context: details.context ?? {},
  });
}
