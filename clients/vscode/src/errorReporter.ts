import * as vscode from "vscode";

import { authedRaw } from "./bfApi";
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
 */

/** The setting a user flips to allow error reports to leave the machine. */
const SETTING_SECTION = "builderforce";
const SETTING_KEY = "reportErrors";

let channel: vscode.OutputChannel | undefined;
let secretStorage: vscode.SecretStorage | undefined;

/**
 * Create the output channel and bind the credential reports are sent with.
 * Call once from `activate`; returns the channel for callers that want to show it.
 */
export function initErrorReporter(context: vscode.ExtensionContext): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel("BuilderForce");
  context.subscriptions.push(channel);
  secretStorage = context.secrets;
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

/**
 * Log a caught error to the output channel, and — when reporting is on and a
 * project is selected — file it in the platform's error store.
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

  if (!isErrorReportingEnabled() || !secretStorage) return;

  try {
    const result = await authedRaw<{ error?: string }>(
      secretStorage,
      "/api/quality-ingest/client-report",
      {
        method: "POST",
        body: JSON.stringify({
          source: "vscode-extension",
          projectId: getSelectedProject()?.id ?? null,
          events: [{
            type: error instanceof Error ? error.name : "ExtensionError",
            message,
            stack: error instanceof Error ? error.stack ?? null : null,
            level: details.level ?? "error",
            operation: details.operation,
            release: vscode.extensions.getExtension("builderforce.builderforce")?.packageJSON?.version,
            timestamp: new Date().toISOString(),
            context: details.context ?? {},
          }],
        }),
      },
    );
    // 422 = no destination project, 429 = the workspace hit its monthly event cap.
    // Both are settled outcomes the user can act on, not failures to retry.
    if (result.status >= 400) {
      logLine(`  (report not filed: HTTP ${result.status}${result.body?.error ? ` ${result.body.error}` : ""})`);
    }
  } catch (reportingError) {
    // Terminal by design: reporting a reporting failure would recurse.
    logLine(`  (report not filed: ${String(reportingError)})`);
  }
}
