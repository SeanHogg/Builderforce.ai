/**
 * The Teach helper's wire protocol: one JSON object per line on stdin/stdout.
 *
 * Pure — no `vscode`, no `child_process` — so the codec and the request/response
 * correlator are unit-testable. The process lives in `teachHelper.ts`.
 *
 * The host sends requests `{id, method, params}`; the helper answers `{id, result}` or
 * `{id, error:{code, message}}` and pushes `{event, ...}` lines of its own.
 */

import type { RunStatus, StepOutcome } from "@seanhogg/builderforce-memory-engine";

export type HelperErrorCode =
  | "bad_request"
  | "unknown_method"
  | "bad_params"
  | "unsupported"
  | "busy"
  | "missing_value"
  | "idle"
  | "record_failed"
  /** `approve.answer` for a gate that is not pending: harmless, treated as a no-op. */
  | "not_waiting"
  | "internal"
  /** Host-side: the helper process exited or could not start. */
  | "helper_gone";

export class HelperError extends Error {
  constructor(readonly code: HelperErrorCode | string, message: string) {
    super(message);
    this.name = "HelperError";
  }
}

export type StepOutcomeWire = StepOutcome;
export type RunFinishStatus = Exclude<RunStatus, "running">;

/** Everything the helper pushes unprompted. */
export type HelperEvent =
  | { event: "run.stepStarted"; runId: string; idx: number }
  | { event: "run.stepFinished"; runId: string; idx: number; outcome: StepOutcomeWire; detail?: string | null }
  | { event: "run.approvalNeeded"; runId: string; idx: number }
  | { event: "run.finished"; runId: string; status: RunFinishStatus; error?: string | null }
  | { event: "record.step"; count: number };

/**
 * One decoded line. `invalid` carries the raw text so the caller can report it. A reply
 * whose `id` is null (the helper could not even read the request's id) is an error reply
 * for the OLDEST request in flight: the helper answers strictly in order.
 */
export type HelperMessage =
  | { kind: "reply"; id: number | null; result?: unknown; error?: { code: string; message: string } }
  | { kind: "event"; event: HelperEvent }
  | { kind: "invalid"; line: string };

/** The line to write for a request (newline-terminated). */
export function encodeRequest(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Decode one line. Never throws: junk becomes `{kind:"invalid"}`. */
export function parseLine(line: string): HelperMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { kind: "invalid", line };
  }
  if (!isObject(raw)) return { kind: "invalid", line };
  if (typeof raw["event"] === "string") return { kind: "event", event: raw as unknown as HelperEvent };
  const err = raw["error"];
  const hasError = isObject(err) && typeof err["message"] === "string";
  if (typeof raw["id"] === "number" || (raw["id"] === null && hasError)) {
    const id = raw["id"] as number | null;
    if (hasError) return { kind: "reply", id, error: { code: String((err as Record<string, unknown>)["code"] ?? "internal"), message: (err as Record<string, string>)["message"]! } };
    return { kind: "reply", id, result: raw["result"] };
  }
  return { kind: "invalid", line };
}

/**
 * Re-frames a byte stream into lines. A chunk may end mid-line (the remainder is held
 * until its newline arrives) or carry several lines at once. Blank lines are dropped.
 */
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split("\n");
    this.rest = parts.pop() ?? "";
    return parts.map((p) => p.replace(/\r$/, "")).filter((p) => p.length > 0);
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}

/** How long a request may wait for its reply unless it says otherwise. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Matches replies to the requests that asked for them, by id. Every request times out
 * (30 s) unless `timeoutMs: null` (a call the person ends, like `record.stop`).
 */
export class RequestCorrelator {
  private nextId = 1;
  /** Insertion-ordered, so the first entry is the OLDEST request in flight. */
  private readonly pending = new Map<number, Pending>();

  /** Register a request; `send` is handed the line to write. Rejects if `send` throws. */
  request(method: string, params: unknown, send: (line: string) => void, opts: { timeoutMs?: number | null } = {}): Promise<unknown> {
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : opts.timeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (timeoutMs !== null) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new HelperError("timeout", `the Teach helper did not answer ${method} within ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      try {
        send(encodeRequest(id, method, params));
      } catch (error) {
        this.drop(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private drop(id: number): Pending | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    return entry;
  }

  /**
   * Settle the request a reply answers. A null id settles the OLDEST pending request with
   * that error. Returns false when nobody was waiting.
   */
  settle(reply: Extract<HelperMessage, { kind: "reply" }>): boolean {
    const id = reply.id ?? this.pending.keys().next().value;
    if (id === undefined) return false;
    const waiting = this.drop(id);
    if (!waiting) return false;
    if (reply.error) waiting.reject(new HelperError(reply.error.code, reply.error.message));
    else waiting.resolve(reply.result);
    return true;
  }

  /** Fail everything in flight (the helper exited). */
  rejectAll(error: Error): void {
    const all = [...this.pending.keys()].map((id) => this.drop(id)!);
    for (const p of all) p.reject(error);
  }

  get inFlight(): number {
    return this.pending.size;
  }
}
