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

/**
 * Fold a run of identical, adjacent signals into one.
 *
 * WHY. The heartbeat samples every 60s so that focus lost mid-window is not billed —
 * the accuracy the sample rate buys is real and this does not give it up. What it does
 * give up is the ROW per sample: five consecutive focused minutes are five rows saying
 * exactly the same thing, one after another, and `activity_signals` is the platform's
 * highest-volume presence feed with an editor left open all day writing into it.
 *
 * Adjacent signals of the same kind and ref merge into one carrying the EARLIEST
 * `occurredAt` and the SUMMED `durationSeconds` / `weight`, which is the same billable
 * time expressed in a fifth of the rows. Adjacency is what keeps it honest: a focused
 * run that is interrupted does not merge across the gap, because the signals are no
 * longer neighbours in the queue — so a person who steps away is still not billed for it.
 *
 * It also collapses the nav storm from walking a file tree with the keyboard: the same
 * file opened twice in a row is one navigation, not two.
 */
export function coalesceSignals(signals: bfApi.VsixActivitySignal[]): bfApi.VsixActivitySignal[] {
  const out: bfApi.VsixActivitySignal[] = [];
  for (const signal of signals) {
    const last = out[out.length - 1];
    const mergeable = last
      && last.kind === signal.kind
      && last.ref === signal.ref
      && last.projectId === signal.projectId
      // A signal carrying its own metadata is a distinct fact someone wants to read
      // back, never a repeat of the one before it.
      && last.metadata == null && signal.metadata == null;
    if (!mergeable) {
      out.push({ ...signal });
      continue;
    }
    // `occurredAt` stays the earliest — the queue is append-ordered, so `last` already
    // holds it — and the quantities add.
    if (signal.durationSeconds != null) last.durationSeconds = (last.durationSeconds ?? 0) + signal.durationSeconds;
    // `weight` ALWAYS sums, including when neither signal set one: an omitted weight
    // means 1, so a merged row that left it unset would claim to be a single signal
    // while standing for several. It is the row's own record of how many it folded.
    last.weight = (last.weight ?? 1) + (signal.weight ?? 1);
  }
  return out;
}

async function flushVsix(): Promise<void> {
  if (!secretsRef || queue.length === 0) return;
  const batch = coalesceSignals(queue);
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

  // Flush on a timer. Every signal carries its own `occurredAt`/`durationSeconds`, so
  // batching five minutes of heartbeats into one POST records exactly the same time —
  // it only stops a focused editor from writing to the platform every 20 seconds.
  // A full queue (25) and disposal still flush immediately. `coalesceSignals` then folds
  // the adjacent duplicates in that batch, so the same five minutes is also one ROW.
  const flushTimer = setInterval(() => { void flushVsix(); }, 5 * 60_000);

  return new vscode.Disposable(() => {
    clearInterval(heartbeat);
    clearInterval(flushTimer);
    disposables.forEach((d) => d.dispose());
    void flushVsix();
  });
}
