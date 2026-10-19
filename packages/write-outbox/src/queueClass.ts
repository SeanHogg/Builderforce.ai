/**
 * Pure classification of the known user-work queues.
 *
 * Durable queues are retained until acknowledged. Best-effort queues may be
 * dropped on failure. This module does not construct a queue and does not
 * rewrite a live constructor — those files are owned by other slices. A host
 * that passes one of these names as `work` gets the retention below.
 *
 *   durable (retain until acked): audit close, run checkpoint, fact publish,
 *   ticket mutation, brain turns (chat history), step rows, chat sync.
 *   best-effort (drop on failure): diagnostics telemetry, session refresh,
 *   QA capture, visitor journey, session replay, tool audit, usage snapshot,
 *   file-change telemetry, remote chunks.
 *
 * Still unclassified, on purpose: `activity` (the editor bills it; the portal
 * drops it), `run-outcomes` (offline teaching, not history and not telemetry),
 * and `host-persist` (one queue mixes chat messages with host telemetry).
 *
 * Live constructors this table does not rewrite (off-limits):
 *   - clients/vscode/src/outboxStorage.ts createDurableOutbox
 *   - clients/vscode/src/errorReporter.ts "error-reports" (diagnostics telemetry,
 *     built durable)
 *   - clients/chrome/src/telemetry/errorReports.ts createErrorReports
 *   - frontend/src/lib/qa/telemetry.ts QaCapture outbox
 *   - clients/vscode/src/workspaceFactsSync.ts syncWorkspaceFacts (fact publish,
 *     drops on failure)
 *   - clients/vscode/src/bfApi.ts updateTaskStatus (ticket mutation, not queued)
 *   - clients/vscode/src/localAuditStore.ts / auditExecution.ts (audit close)
 *   - clients/vscode/src/runRecovery.ts recordRunCheckpoint
 *   - clients/vscode/src/sessionsSnapshotStore.ts (session refresh)
 */

import type { OutboxRetention } from "./types.js";

/** Canonical ids for the queues this classifier owns. */
export const USER_WORK_QUEUES = [
  "audit-close",
  "run-checkpoint",
  "fact-publish",
  "ticket-mutation",
  "brain-turns",
  "steps",
  "chat-sync",
  "diagnostics-telemetry",
  "session-refresh",
  "qa-capture",
  "visitor-journey",
  "session-replay",
  "tool-audit",
  "usage-snapshot",
  "file-change",
  "remote-chunks",
] as const;

export type UserWorkQueue = (typeof USER_WORK_QUEUES)[number];

/** What a failed send does. Paired with retention and never chosen independently. */
export type QueueFailurePolicy = "retain-until-acked" | "drop-on-failure";

export interface QueueClassification {
  queue: UserWorkQueue;
  retention: OutboxRetention;
  onFailure: QueueFailurePolicy;
}

const CLASS_BY_QUEUE: Readonly<Record<UserWorkQueue, QueueClassification>> = {
  "audit-close": { queue: "audit-close", retention: "durable", onFailure: "retain-until-acked" },
  "run-checkpoint": { queue: "run-checkpoint", retention: "durable", onFailure: "retain-until-acked" },
  "fact-publish": { queue: "fact-publish", retention: "durable", onFailure: "retain-until-acked" },
  "ticket-mutation": { queue: "ticket-mutation", retention: "durable", onFailure: "retain-until-acked" },
  "brain-turns": { queue: "brain-turns", retention: "durable", onFailure: "retain-until-acked" },
  steps: { queue: "steps", retention: "durable", onFailure: "retain-until-acked" },
  "chat-sync": { queue: "chat-sync", retention: "durable", onFailure: "retain-until-acked" },
  "diagnostics-telemetry": {
    queue: "diagnostics-telemetry",
    retention: "best-effort",
    onFailure: "drop-on-failure",
  },
  "session-refresh": { queue: "session-refresh", retention: "best-effort", onFailure: "drop-on-failure" },
  "qa-capture": { queue: "qa-capture", retention: "best-effort", onFailure: "drop-on-failure" },
  "visitor-journey": { queue: "visitor-journey", retention: "best-effort", onFailure: "drop-on-failure" },
  "session-replay": { queue: "session-replay", retention: "best-effort", onFailure: "drop-on-failure" },
  "tool-audit": { queue: "tool-audit", retention: "best-effort", onFailure: "drop-on-failure" },
  "usage-snapshot": { queue: "usage-snapshot", retention: "best-effort", onFailure: "drop-on-failure" },
  "file-change": { queue: "file-change", retention: "best-effort", onFailure: "drop-on-failure" },
  "remote-chunks": { queue: "remote-chunks", retention: "best-effort", onFailure: "drop-on-failure" },
};

/**
 * Names a live constructor already uses, mapped onto a canonical queue.
 * `activity`, `run-outcomes`, and `host-persist` are not here.
 */
const ALIAS_TO_QUEUE: Readonly<Record<string, UserWorkQueue>> = {
  "audit-close": "audit-close",
  "close-audit": "audit-close",
  "run-checkpoint": "run-checkpoint",
  "fact-publish": "fact-publish",
  "ticket-mutation": "ticket-mutation",
  "brain-turns": "brain-turns",
  "brain-turn": "brain-turns",
  "pending-turns": "brain-turns",
  steps: "steps",
  step: "steps",
  "run-steps": "steps",
  "brain-steps": "steps",
  "chat-sync": "chat-sync",
  "rovr-chat": "chat-sync",
  "builderforce-outbox:rovr": "chat-sync",
  "builderforce-outbox:rovr-steps": "steps",
  "diagnostics-telemetry": "diagnostics-telemetry",
  "diagnostic-telemetry": "diagnostics-telemetry",
  "error-reports": "diagnostics-telemetry",
  "error-report": "diagnostics-telemetry",
  "client-report": "diagnostics-telemetry",
  "client-reports": "diagnostics-telemetry",
  "builderforce-outbox:rovr-errors": "diagnostics-telemetry",
  "session-refresh": "session-refresh",
  "refresh-session": "session-refresh",
  "refresh-sessions": "session-refresh",
  "sessions-refresh": "session-refresh",
  "qa-capture": "qa-capture",
  "qa-telemetry": "qa-capture",
  "visitor-journey": "visitor-journey",
  "visitor-events": "visitor-journey",
  journey: "visitor-journey",
  "session-replay": "session-replay",
  replay: "session-replay",
  "replay-chunks": "session-replay",
  "tool-audit": "tool-audit",
  "tool-audits": "tool-audit",
  "usage-snapshot": "usage-snapshot",
  "usage-snapshots": "usage-snapshot",
  "file-change": "file-change",
  "file-changes": "file-change",
  "remote-chunks": "remote-chunks",
  "remote-chunk": "remote-chunks",
};

const STORAGE_PREFIX = "builderforce.outbox.";

function normalizeQueueName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

function canonicalQueue(name: string): UserWorkQueue | undefined {
  let key = normalizeQueueName(name);
  if (!key) return undefined;
  if (key.startsWith(STORAGE_PREFIX)) key = key.slice(STORAGE_PREFIX.length);
  if (key === "steps" || key.startsWith("steps:")) return "steps";
  return ALIAS_TO_QUEUE[key];
}

/**
 * Classify a known user-work queue. Unknown, empty, or non-string names are
 * unclassified — this table does not guess a retention for them.
 */
export function classifyUserWorkQueue(name: string | undefined | null): QueueClassification | undefined {
  if (typeof name !== "string") return undefined;
  const queue = canonicalQueue(name);
  if (!queue) return undefined;
  return CLASS_BY_QUEUE[queue];
}

/** Retention for a known queue, or undefined when the name is not in the table. */
export function retentionForQueue(name: string | undefined | null): OutboxRetention | undefined {
  return classifyUserWorkQueue(name)?.retention;
}
