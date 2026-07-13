import * as vscode from "vscode";
import * as bfApi from "./bfApi";

/**
 * Editor-side activity capture.
 *
 * Reports audited "click sense" + engagement signals from VS Code — session
 * heartbeats while the editor is focused, file-open navigations, and any explicit
 * signal feature code emits via `trackVsix(...)`. Batched and flushed to
 * POST /api/activity/ingest (tenant-JWT), where they resolve into billable time.
 * Best-effort: capture never disrupts the editor.
 */

let secretsRef: vscode.SecretStorage | undefined;
let queue: bfApi.VsixActivitySignal[] = [];

/** Emit one activity signal from the editor. */
export function trackVsix(kind: string, opts: Omit<bfApi.VsixActivitySignal, "kind"> = {}): void {
  queue.push({ kind, occurredAt: new Date().toISOString(), ...opts });
  if (queue.length >= 25) void flushVsix();
}

async function flushVsix(): Promise<void> {
  if (!secretsRef || queue.length === 0) return;
  const batch = queue;
  queue = [];
  await bfApi.postActivitySignals(secretsRef, batch);
}

/**
 * Start editor activity capture. Emits a heartbeat every 60s WHILE the window is
 * focused (so idle time isn't billed), a nav signal on the active file changing,
 * and flushes the queue on a timer. Returns a Disposable for the extension's
 * subscriptions.
 */
export function initActivity(secrets: vscode.SecretStorage): vscode.Disposable {
  secretsRef = secrets;
  const disposables: vscode.Disposable[] = [];

  // Heartbeat while focused — a 60s active-time span.
  const heartbeat = setInterval(() => {
    if (vscode.window.state.focused) {
      trackVsix("heartbeat", { durationSeconds: 60 });
    }
  }, 60_000);

  // Navigation: the active editor changed (a file open / switch).
  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) trackVsix("nav", { ref: ed.document.uri.fsPath.split(/[\\/]/).pop() });
    }),
  );

  // Flush on a timer.
  const flushTimer = setInterval(() => { void flushVsix(); }, 20_000);

  return new vscode.Disposable(() => {
    clearInterval(heartbeat);
    clearInterval(flushTimer);
    disposables.forEach((d) => d.dispose());
    void flushVsix();
  });
}
