import type * as vscode from "vscode";
import { authedRaw } from "./transport";

/** One activity signal the VSIX reports for the billable-timecard pipeline. */
export interface VsixActivitySignal {
  kind: string;
  ref?: string;
  weight?: number;
  durationSeconds?: number;
  projectId?: number;
  occurredAt?: string;
  metadata?: unknown;
}

/**
 * Push a batch of audited "click sense" signals from the editor (source 'vscode'). The
 * server attributes each signal to the signed-in user + active tenant and resolves it
 * into billable time (see api/src/presentation/routes/activityRoutes.ts).
 *
 * THROWS on failure — its one caller is the durable activity outbox (`activity.ts`),
 * which keeps the batch and replays it under the same `idempotencyKey`, so a batch the
 * server already took is answered from its idempotency record instead of billed twice.
 * No usable credential is a failure too (offline, the token exchange cannot succeed).
 */
export async function postActivitySignals(
  secrets: vscode.SecretStorage,
  signals: VsixActivitySignal[],
  idempotencyKey: string,
  /** The tenant the batch was queued for — never sent as another. */
  asTenant?: number,
): Promise<void> {
  if (signals.length === 0) return;
  const r = await authedRaw<unknown>(secrets, `/api/activity/ingest`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ signals }),
    asTenant,
  });
  if (r.status >= 400) {
    throw Object.assign(new Error(`/api/activity/ingest → HTTP ${r.status} ${r.text.slice(0, 160)}`), { status: r.status });
  }
}
