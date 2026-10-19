/**
 * Dead-letter export and repair for a person. No UI and no network.
 *
 * Export returns the full payload so a person can repair it. Requeue puts that
 * payload back only for durable user work that still has a body. Best-effort
 * telemetry, a missing payload, and an unclassified queue stay dead. Known
 * queue names win over a retention stamp, so a telemetry letter built as
 * durable is not repaired as user work.
 */

import { classifyQueue } from "./classifyQueue.js";
import type { OutboxRetention } from "./types.js";

/** A dead letter, or the overlapping fields of an outbox entry. */
export interface DeadLetterRepairSource {
  id: string;
  /** Queue name. A string `key` is used when this is absent. */
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

export type DeadLetterStayReason = "best-effort" | "missing-payload" | "unclassified";

/** One exported letter, including the body a person repairs. */
export interface ExportedDeadLetter {
  id: string;
  queue: string;
  reason: string;
  occurredAt: string;
  /** Full body. Null when the letter has nothing to repair. */
  payload: unknown;
  hasPayload: boolean;
  retention: OutboxRetention | "unclassified";
  repairable: boolean;
  /** Present only when the letter must stay dead. */
  whyNot?: DeadLetterStayReason;
}

/** A durable letter with its refusal cleared, ready to put back on the queue. */
export interface RequeuedDeadLetter {
  id: string;
  queue: string;
  retention: "durable";
  payload: unknown;
}

export interface DeadLetterExportRepairResult {
  /** Every letter, with its full payload. Input order. */
  letters: ExportedDeadLetter[];
  /** The letter put back, or null when it must stay dead or the id is unknown. */
  requeued: RequeuedDeadLetter | null;
}

export interface RequeueDeadLetterOptions {
  /**
   * When this property is present, including null, it replaces the stored body.
   * Omit it to requeue the stored payload.
   */
  payload?: unknown;
  /** Queue name when the records do not stamp one. */
  queue?: string;
}

function queueNameOf(record: DeadLetterRepairSource): string {
  if (typeof record.queue === "string" && record.queue.trim() !== "") return record.queue.trim();
  if (typeof record.key === "string" && record.key.trim() !== "") return record.key.trim();
  return "";
}

function reasonOf(record: DeadLetterRepairSource): string {
  const fromLetter = record.deadLetter?.reason;
  if (typeof fromLetter === "string" && fromLetter.trim() !== "") return fromLetter;
  if (typeof record.reason === "string") return record.reason;
  return "";
}

function occurredAtOf(record: DeadLetterRepairSource): string {
  const fromLetter = record.deadLetter?.at;
  if (typeof fromLetter === "string" && fromLetter.trim() !== "") return fromLetter;
  if (typeof record.occurredAt === "string") return record.occurredAt;
  return "";
}

/** An explicit `payload` property, even null, wins over `item`. */
function storedBody(record: DeadLetterRepairSource): { present: boolean; value: unknown } {
  if ("payload" in record) {
    const value = record.payload;
    return { present: value !== undefined && value !== null, value };
  }
  if ("item" in record && record.item !== undefined && record.item !== null) {
    return { present: true, value: record.item };
  }
  return { present: false, value: undefined };
}

function retentionOf(record: DeadLetterRepairSource, queue: string): OutboxRetention | "unclassified" {
  const classified = classifyQueue(queue);
  if (classified) return classified.retention;
  if (record.retention === "durable" || record.retention === "best-effort") return record.retention;
  return "unclassified";
}

function stampQueue(
  records: readonly DeadLetterRepairSource[],
  queue: string | undefined,
): DeadLetterRepairSource[] {
  const named = typeof queue === "string" ? queue.trim() : "";
  if (named === "") return records.slice();
  return records.map((record) => (queueNameOf(record) ? record : { ...record, queue: named }));
}

function exportOne(record: DeadLetterRepairSource): ExportedDeadLetter {
  const queue = queueNameOf(record);
  const retention = retentionOf(record, queue);
  const body = storedBody(record);
  const id = typeof record.id === "string" ? record.id : "";
  const base: ExportedDeadLetter = {
    id,
    queue,
    reason: reasonOf(record),
    occurredAt: occurredAtOf(record),
    payload: body.present ? body.value : null,
    hasPayload: body.present,
    retention,
    repairable: false,
  };
  if (!body.present) return { ...base, whyNot: "missing-payload" };
  if (retention === "best-effort") return { ...base, whyNot: "best-effort" };
  if (retention !== "durable" || id.trim() === "") return { ...base, whyNot: "unclassified" };
  return { ...base, repairable: true };
}

/**
 * Export dead letters with their full payloads. Does not mutate `records`,
 * remove a letter, or send anything.
 */
export function exportDeadLettersForRepair(
  records: readonly DeadLetterRepairSource[],
  queue?: string,
): ExportedDeadLetter[] {
  return stampQueue(records, queue).map(exportOne);
}

function hasOwnPayload(options: RequeueDeadLetterOptions | undefined): boolean {
  return options !== undefined && Object.prototype.hasOwnProperty.call(options, "payload");
}

/**
 * Requeue one dead letter. Returns the payload to put back, or null when the
 * letter must stay dead. Does not mutate `records` and does not send.
 *
 * Pass `options.payload` (including null) to requeue a body the person repaired.
 * A best-effort, missing, or unclassified letter stays dead even then.
 */
export function requeueDeadLetter(
  records: readonly DeadLetterRepairSource[],
  id: string,
  options?: RequeueDeadLetterOptions,
): RequeuedDeadLetter | null {
  const wanted = typeof id === "string" ? id.trim() : "";
  if (!wanted) return null;
  const stamped = stampQueue(records, options?.queue);
  const source = stamped.find((record) => record.id === wanted);
  if (!source) return null;
  const exported = exportOne(source);
  if (!exported.repairable) return null;
  const body = hasOwnPayload(options) ? options!.payload : exported.payload;
  if (body === undefined || body === null) return null;
  return {
    id: wanted,
    queue: exported.queue,
    retention: "durable",
    payload: body,
  };
}

/**
 * Export every dead letter and requeue one of them.
 *
 * Returns the full payloads and, when the named id is durable user work with
 * a body, the letter to put back. A blank, unknown, best-effort, payload-less,
 * or unclassified id is exported and left dead. Does not mutate `records`.
 */
export function exportAndRequeueDeadLetter(
  records: readonly DeadLetterRepairSource[],
  id: string,
  options?: RequeueDeadLetterOptions,
): DeadLetterExportRepairResult {
  const letters = exportDeadLettersForRepair(records, options?.queue);
  return {
    letters,
    requeued: requeueDeadLetter(records, id, options),
  };
}
