/**
 * G08 — closing an audit is a local completion, not a silent cloud launch.
 *
 * `planAuditClose` decides the checkpoint. `closeAuditLocally` writes it through
 * the existing local audit store so a restarted store can read `closedLocally`,
 * and refuses a cloud launch for that record. It calls `recoverInterruptedAuditRuns`
 * directly (not via extension activation).
 *
 * No vscode, no fetch, no bfApi. This module does not call `startSystemAudit`.
 */
import type { LocalFirstStore } from "@builderforce/local-first";
import {
  closeLocalAuditRun,
  getLocalAuditRun,
  recoverInterruptedAuditRuns,
  type LocalAuditRun,
} from "./localAuditStore";

export interface AuditCloseIdentity {
  auditId: string;
  projectId: number;
  requestId: string;
}

/** Durable "closed locally" record. Status is completed, and cloud is not launched. */
export interface AuditCloseCheckpoint extends AuditCloseIdentity {
  status: "completed";
  launchCloud: false;
  closedLocally: true;
}

/**
 * Durable next-start record for a run the host did not finish.
 * Status is interrupted, never completed, and cloud is not launched.
 */
export interface AuditCloseNextStartJob extends AuditCloseIdentity {
  status: "interrupted";
  launchCloud: false;
  kind: "next-start";
}

export type AuditCloseRefusal = "missing-account" | "dispatch-not-allowed";

export type AuditClosePlan =
  | { action: "complete-local"; checkpoint: AuditCloseCheckpoint }
  | { action: "defer-local"; job: AuditCloseNextStartJob }
  | { action: "refuse-cloud"; reason: AuditCloseRefusal };

export interface AuditCloseInput extends AuditCloseIdentity {
  /** True when the local audit run has finished and close should record completion. */
  runFinished: boolean;
  /** True when the extension host is shutting down. */
  hostClosing: boolean;
  /** True when the caller asked this close to launch a cloud audit. */
  launchCloud?: boolean;
  /** Account identity required before any later cloud job. Blank is not an identity. */
  accountId?: string;
  /** Explicit permission to dispatch cloud work. Absent or false is not permission. */
  dispatchAllowed?: boolean;
}

function hasAccount(accountId: string | undefined): boolean {
  return typeof accountId === "string" && accountId.trim().length > 0;
}

function checkpointOf(input: AuditCloseInput): AuditCloseCheckpoint {
  return {
    auditId: input.auditId,
    projectId: input.projectId,
    requestId: input.requestId,
    status: "completed",
    launchCloud: false,
    closedLocally: true,
  };
}

function nextStartOf(input: AuditCloseInput): AuditCloseNextStartJob {
  return {
    auditId: input.auditId,
    projectId: input.projectId,
    requestId: input.requestId,
    status: "interrupted",
    launchCloud: false,
    kind: "next-start",
  };
}

/**
 * Plan what close may persist. The return value never launches cloud work.
 *
 * A request to launch cloud without an account, or without `dispatchAllowed`,
 * is refused before any local write is planned — close must not become a
 * silent cloud start. Otherwise a finished run is a local completion, and a
 * host close of an unfinished run is a local next-start job.
 */
export function planAuditClose(input: AuditCloseInput): AuditClosePlan {
  if (input.launchCloud === true) {
    if (!hasAccount(input.accountId)) {
      return { action: "refuse-cloud", reason: "missing-account" };
    }
    if (input.dispatchAllowed !== true) {
      return { action: "refuse-cloud", reason: "dispatch-not-allowed" };
    }
    // Identity and permission exist, but this close still does not launch.
    // A later cloud job is a separate, explicit dispatch — not a close side effect.
  }

  if (input.runFinished) {
    return { action: "complete-local", checkpoint: checkpointOf(input) };
  }

  // Host shutdown of an unfinished run, and any close that is not a local
  // completion, stay interrupted. Never mark them completed, and never launch.
  return { action: "defer-local", job: nextStartOf(input) };
}

export interface DurableAuditClose {
  readonly store: LocalFirstStore;
  readonly deviceId: string;
  readonly auditId: string;
  readonly projectId: number;
  readonly runId: string;
  readonly source: {
    readonly surface: "vsix";
    readonly trigger: "close";
    readonly branch?: string;
    readonly commit?: string;
    readonly dirty?: boolean;
  };
  readonly now?: string;
}

export type CloudLaunchDecision =
  | { readonly launch: false; readonly reason: "locally_complete" }
  | { readonly launch: true };

/**
 * A locally complete audit must not launch cloud work, even when a later
 * caller would otherwise be allowed to. Anything not closed locally is not
 * this refusal.
 */
export function refuseCloudLaunch(record: LocalAuditRun | null | undefined): CloudLaunchDecision {
  if (record?.record?.payload.closedLocally === true) {
    return { launch: false, reason: "locally_complete" };
  }
  return { launch: true };
}

/** Read the close record. A new store loaded from the same snapshot is a restart. */
export async function readClosedAudit(store: LocalFirstStore, runId: string): Promise<LocalAuditRun | null> {
  return (await getLocalAuditRun(store, runId)) ?? null;
}

/**
 * Close writes a durable local-complete record and refuses cloud launch.
 * `recoverInterruptedAuditRuns` is called from this close path, not from extension.ts.
 */
export async function closeAuditLocally(input: DurableAuditClose): Promise<{
  readonly record: LocalAuditRun;
  readonly cloud: CloudLaunchDecision;
}> {
  const fixedNow = input.now;
  const deps = {
    deviceId: input.deviceId,
    ...(fixedNow ? { now: () => new Date(fixedNow) } : {}),
  };
  await recoverInterruptedAuditRuns(input.store, deps);
  const source: Record<string, unknown> = { ...input.source };
  await closeLocalAuditRun(input.store, deps, {
    auditId: input.auditId,
    projectId: input.projectId,
    runId: input.runId,
    source,
  });
  const record = await getLocalAuditRun(input.store, input.runId);
  if (!record) throw new Error("local_complete_missing");
  const cloud = refuseCloudLaunch(record);
  if (cloud.launch) throw new Error("locally_complete_refused");
  return { record, cloud };
}
