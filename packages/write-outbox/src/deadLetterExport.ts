/**
 * User-visible dead-letter export and repair plan.
 *
 * Given dead-letter records, produce a JSON-serializable export and a plan
 * that says which entries can be requeued. Requeue is durable queues only,
 * and only when a payload is present. Best-effort entries, and any entry
 * with no payload, stay dead. The callable repair is
 * `exportAndRequeueDeadLetter` in `./deadLetterRepair.ts`.
 */

import { classifyUserWorkQueue } from "./queueClass.js";
import type { OutboxRetention } from "./types.js";

/** A dead letter, or the overlapping fields of an outbox entry. */
export interface DeadLetterRecord {
  id: string;
  /** Queue name. A string `key` is used when this is absent (lane name). */
  queue?: string;
  key?: unknown;
  item?: unknown;
  /** Explicit body. When the property is present, including null, it wins over `item`. */
  payload?: unknown;
  reason?: string;
  occurredAt?: string;
  retention?: OutboxRetention;
  deadLetter?: { reason?: string; at?: string };
}

export interface DeadLetterExportRow {
  id: string;
  queue: string;
  reason: string;
  occurredAt: string;
  payloadSummary: string;
}

export type StayDeadReason = "best-effort" | "missing-payload" | "unclassified";

export interface DeadLetterRepairDecision {
  id: string;
  queue: string;
  retention: OutboxRetention | "unclassified";
  action: "requeue" | "stay-dead";
  /** Present only when the entry must stay dead. */
  why?: StayDeadReason;
}

export interface DeadLetterRepairPlan {
  /** Durable entries that still have a payload. A later slice may requeue these ids. */
  requeue: DeadLetterRepairDecision[];
  /** Best-effort, missing payload, or a queue this classifier does not own. */
  stayDead: DeadLetterRepairDecision[];
}

export interface DeadLetterExportResult {
  entries: DeadLetterExportRow[];
  repair: DeadLetterRepairPlan;
}

const SUMMARY_LIMIT = 160;

function clip(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function queueNameOf(record: DeadLetterRecord): string {
  if (typeof record.queue === "string" && record.queue.trim() !== "") return record.queue.trim();
  if (typeof record.key === "string" && record.key.trim() !== "") return record.key.trim();
  return "";
}

function reasonOf(record: DeadLetterRecord): string {
  const fromLetter = record.deadLetter?.reason;
  if (typeof fromLetter === "string" && fromLetter.trim() !== "") return fromLetter;
  if (typeof record.reason === "string") return record.reason;
  return "";
}

function occurredAtOf(record: DeadLetterRecord): string {
  const fromLetter = record.deadLetter?.at;
  if (typeof fromLetter === "string" && fromLetter.trim() !== "") return fromLetter;
  if (typeof record.occurredAt === "string") return record.occurredAt;
  return "";
}

/**
 * The body a repair may resend. An explicit `payload` property, even null,
 * wins over `item` so a stripped body cannot be repaired from a stale item.
 */
function bodyOf(record: DeadLetterRecord): { present: boolean; value: unknown } {
  if ("payload" in record) {
    const value = record.payload;
    return { present: value !== undefined && value !== null, value };
  }
  if ("item" in record && record.item !== undefined && record.item !== null) {
    return { present: true, value: record.item };
  }
  return { present: false, value: undefined };
}

function summarizePayload(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return clip(value, SUMMARY_LIMIT);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return "";
    return clip(json, SUMMARY_LIMIT);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Known queue names win over a retention stamp. A live constructor that
 * built diagnostics telemetry as durable must not be repaired as user work.
 * An unknown queue may still use an explicit retention; otherwise it stays
 * unclassified and is not requeued.
 */
function retentionOf(record: DeadLetterRecord, queue: string): OutboxRetention | "unclassified" {
  const classified = classifyUserWorkQueue(queue);
  if (classified) return classified.retention;
  if (record.retention === "durable" || record.retention === "best-effort") return record.retention;
  return "unclassified";
}

function decide(record: DeadLetterRecord): DeadLetterRepairDecision {
  const queue = queueNameOf(record);
  const retention = retentionOf(record, queue);
  const body = bodyOf(record);
  const id = typeof record.id === "string" ? record.id : "";
  if (!body.present) {
    return { id, queue, retention, action: "stay-dead", why: "missing-payload" };
  }
  if (retention === "best-effort") {
    return { id, queue, retention, action: "stay-dead", why: "best-effort" };
  }
  if (retention !== "durable" || id.trim() === "") {
    return { id, queue, retention, action: "stay-dead", why: "unclassified" };
  }
  return { id, queue, retention, action: "requeue" };
}

/**
 * Export dead letters and plan which ones a user may repair.
 * Does not mutate `records`, send anything, or delete a letter.
 */
export function exportDeadLetterAction(records: readonly DeadLetterRecord[]): DeadLetterExportResult {
  const entries: DeadLetterExportRow[] = [];
  const requeue: DeadLetterRepairDecision[] = [];
  const stayDead: DeadLetterRepairDecision[] = [];
  for (const record of records) {
    const body = bodyOf(record);
    entries.push({
      id: typeof record.id === "string" ? record.id : "",
      queue: queueNameOf(record),
      reason: reasonOf(record),
      occurredAt: occurredAtOf(record),
      payloadSummary: summarizePayload(body.present ? body.value : undefined),
    });
    const decision = decide(record);
    if (decision.action === "requeue") requeue.push(decision);
    else stayDead.push(decision);
  }
  return { entries, repair: { requeue, stayDead } };
}
