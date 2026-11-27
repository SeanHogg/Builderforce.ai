/**
 * The Teach helper's wire protocol: one JSON object per line on stdin/stdout.
 *
 * Pure — no `vscode`, no `child_process` — so the codec and the request/response
 * correlator are unit-testable. The process lives in `teachHelper.ts`.
 *
 * The host sends requests `{id, method, params}`; the helper answers `{id, result}` or
 * `{id, error:{code, message}}` and pushes `{event, ...}` lines of its own.
 */

export type HelperErrorCode =
  | "bad_request"
  | "unknown_method"
  | "bad_params"
  | "unsupported"
  | "busy"
  | "missing_value"
  | "idle"
  | "record_failed"
  | "internal"
  /** Host-side: the helper process exited or could not start. */
  | "helper_gone";

export class HelperError extends Error {
  constructor(readonly code: HelperErrorCode | string, message: string) {
    super(message);
    this.name = "HelperError";
  }
}

export type StepOutcomeWire = "ok" | "fallback" | "failed" | "approved" | "denied";
export type RunFinishStatus = "succeeded" | "failed" | "stopped" | "denied";

/** Everything the helper pushes unprompted. */
export type HelperEvent =
  | { event: "run.stepStarted"; idx: number }
  | { event: "run.stepFinished"; idx: number; outcome: StepOutcomeWire; detail?: string | null }
  | { event: "run.approvalNeeded"; idx: number }
  | { event: "run.finished"; status: RunFinishStatus; error?: string | null }
  | { event: "record.step"; count: number };

/** One decoded line. `invalid` carries the raw text so the caller can report it. */
export type HelperMessage =
  | { kind: "reply"; id: number; result?: unknown; error?: { code: string; message: string } }
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
  if (typeof raw["id"] === "number") {
    const err = raw["error"];
    if (isObject(err) && typeof err["message"] === "string") {
      return { kind: "reply", id: raw["id"], error: { code: String(err["code"] ?? "internal"), message: err["message"] } };
    }
    return { kind: "reply", id: raw["id"], result: raw["result"] };
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
}

/** Matches replies to the requests that asked for them, by id. */
export class RequestCorrelator {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  /** Register a request; `send` is handed the line to write. Rejects if `send` throws. */
  request(method: string, params: unknown, send: (line: string) => void): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        send(encodeRequest(id, method, params));
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Settle the request a reply answers. Returns false for an id nobody is waiting on. */
  settle(reply: Extract<HelperMessage, { kind: "reply" }>): boolean {
    const waiting = this.pending.get(reply.id);
    if (!waiting) return false;
    this.pending.delete(reply.id);
    if (reply.error) waiting.reject(new HelperError(reply.error.code, reply.error.message));
    else waiting.resolve(reply.result);
    return true;
  }

  /** Fail everything in flight (the helper exited). */
  rejectAll(error: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(error);
  }

  get inFlight(): number {
    return this.pending.size;
  }
}
