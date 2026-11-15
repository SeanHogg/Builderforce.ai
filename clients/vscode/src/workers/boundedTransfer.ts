/**
 * THE bounded transfer of a large result from a `worker_threads` worker to the extension host — ONE primitive every worker
 * whose reply scales with the repository or the run uses: the L3 analysis worker (`knowledge/l3WorkerEntry.ts`), the run
 * delta's engine worker (`runDelta/deltaWorker.ts`) and the run delta's TypeScript checker (`runDelta/analyzers/typescriptAnalyzer.ts`,
 * an eval'd worker that embeds {@link TRANSFER_SENDER_SOURCE}).
 *
 * Why: `postMessage` structured-clones its whole payload into ONE serializer buffer, which V8 grows by doubling OUTSIDE the
 * worker's heap. In Electron an off-heap allocation that fails terminates the WHOLE process — the extension host, every chat
 * in it — and `resourceLimits.maxOldGenerationSizeMb` does not bound it. A 20k-file analysis posted as one message did
 * exactly that (an OOM on a 0x93ffffc0-byte serializer growth). So nothing large is ever posted as one message:
 *
 *   - the sender ({@link sendParts}, or {@link postBounded} over a value's array paths) sends each large array as `part`
 *     messages of at most {@link PART_BYTES} (estimated), before the small message that completes the result;
 *   - one item over a part's size is refused, never sent alone as a giant message;
 *   - it keeps a running estimate of everything sent, and stops with an error coded {@link RESULT_OVER_BUDGET} once it passes
 *     {@link TRANSFER_BUDGET_BYTES} — the caller reports that stable error instead of building the message;
 *   - the receiver ({@link PartsReceiver}) collects the parts by key, and {@link assembleBounded} puts them back.
 *
 * The estimate ({@link estimatedBytes}) is twice an item's JSON length: a clone writes a string as UTF-16 when any character
 * is outside Latin-1, so twice the JSON length bounds it. Pure: no `worker_threads`, no `vscode` — the port is the caller's.
 */

/** The estimated size one `part` message stays under; one item over it is refused. */
export const PART_BYTES = 8 * 1024 * 1024;
/** The estimated size a whole result may reach (what the host reassembles on its heap); past it the sender stops. */
export const TRANSFER_BUDGET_BYTES = 256 * 1024 * 1024;
/** The stable code of a result over its transfer budget (a caller prefixes its own name, e.g. `l3_result_over_budget`). */
export const RESULT_OVER_BUDGET = "result_over_budget";

/** One bounded slice of the array `key`, sent ahead of the message that completes the result. */
export interface TransferPart {
  type: "part";
  key: string;
  items: unknown[];
}

export interface TransferLimits {
  partBytes?: number;
  budgetBytes?: number;
}

/** The error a sender stops with: the result (or one item of it) passed the budget; nothing past it was sent. */
export type TransferOverBudget = Error & { code: typeof RESULT_OVER_BUDGET; estimatedBytes: number; budgetBytes: number };

/** Whether `error` is (or carries the code of) a result over its transfer budget — on either side of the thread boundary. */
export function isOverBudget(error: unknown): error is TransferOverBudget {
  const e = error as { code?: unknown; message?: unknown } | null;
  return (typeof e?.code === "string" && e.code.endsWith(RESULT_OVER_BUDGET)) || String(e?.message ?? "").includes(RESULT_OVER_BUDGET);
}

/** The estimated cloned size of plain data: twice its JSON length (UTF-16 safe); undefined ⇒ 0. */
export function estimatedBytes(value: unknown): number {
  return value === undefined ? 0 : 2 * (JSON.stringify(value)?.length ?? 0);
}

/**
 * The sender itself, SELF-CONTAINED (it reads nothing outside its own parameters), so an eval'd worker can embed its source
 * ({@link TRANSFER_SENDER_SOURCE}). Same estimate as {@link estimatedBytes}, same error as {@link isOverBudget} recognises.
 */
function sendPartsWith(
  post: (part: { type: "part"; key: string; items: unknown[] }) => void,
  arrays: Iterable<readonly [string, readonly unknown[]]>,
  partBytes: number,
  budget: number,
  spent: number,
): number {
  const code = "result_over_budget";
  const over = (estimated: number, why: string): Error => Object.assign(
    new Error(`${code}: ${why} (estimated ${estimated} bytes, budget ${budget}); it is not sent`),
    { code, estimatedBytes: estimated, budgetBytes: budget, name: "TransferOverBudget" },
  );
  let total = spent;
  if (total > budget) throw over(total, "the result passed its budget");
  for (const [key, items] of arrays) {
    let batch: unknown[] = [];
    let batchBytes = 0;
    for (const item of items) {
      const bytes = item === undefined ? 0 : 2 * (JSON.stringify(item)?.length ?? 0);
      if (bytes > partBytes) throw over(bytes, `one item of ${key} passed the part size ${partBytes}`);
      total += bytes;
      if (total > budget) throw over(total, "the result passed its budget");
      if (batchBytes > 0 && batchBytes + bytes > partBytes) {
        post({ type: "part", key, items: batch });
        batch = [];
        batchBytes = 0;
      }
      batch.push(item);
      batchBytes += bytes;
    }
    if (batch.length > 0) post({ type: "part", key, items: batch });
  }
  return total;
}

/** The sender's source, for a worker that is eval'd from a string: `const send = ${TRANSFER_SENDER_SOURCE}; send(post, arrays, partBytes, budget, spent)`. */
export const TRANSFER_SENDER_SOURCE = `(${sendPartsWith.toString()})`;

/**
 * Sends every array as bounded parts through `post`, keeping a running estimate that starts at `spent` (the completing
 * message's own size). Returns the total estimate. Throws a {@link TransferOverBudget} — having sent nothing past the budget —
 * once the estimate passes it, or one item passes a part; the receiver drops what it collected when it hears the error.
 */
export function sendParts(
  post: (part: TransferPart) => void,
  arrays: Iterable<readonly [key: string, items: readonly unknown[]]>,
  limits: TransferLimits = {},
  spent = 0,
): number {
  return sendPartsWith(post, arrays, limits.partBytes ?? PART_BYTES, limits.budgetBytes ?? TRANSFER_BUDGET_BYTES, spent);
}

/** Whether a worker's message is a {@link TransferPart}. */
export function isTransferPart(message: unknown): message is TransferPart {
  const m = message as Partial<TransferPart> | null;
  return !!m && m.type === "part" && typeof m.key === "string" && Array.isArray(m.items);
}

/** Collects the parts of one result, by key, on the receiving thread. */
export class PartsReceiver {
  private readonly arrays = new Map<string, unknown[]>();

  /** Takes `message` when it is a part (true); anything else is the caller's (false). */
  accept(message: unknown): boolean {
    if (!isTransferPart(message)) return false;
    const held = this.arrays.get(message.key);
    if (held) for (const item of message.items) held.push(item);
    else this.arrays.set(message.key, message.items);
    return true;
  }

  /** The items collected under `key` (none ⇒ empty), forgotten here. */
  take<T>(key: string): T[] {
    const items = this.arrays.get(key) ?? [];
    this.arrays.delete(key);
    return items as T[];
  }

  /** Drops everything collected (the result failed). */
  clear(): void {
    this.arrays.clear();
  }
}

type Visit = (array: readonly unknown[], key: string) => unknown[];

/**
 * Rebuilds `node` along one array path (dot-separated; `*` steps into every element of an array), copying only what lies on
 * the path; at the array the path names, `visit` decides what stands there. A path that is absent leaves the node as it is.
 */
function along(node: unknown, segments: readonly string[], key: string, visit: Visit): unknown {
  if (segments.length === 0) return Array.isArray(node) ? visit(node, key) : node;
  const [segment, ...rest] = segments;
  if (segment === "*") return Array.isArray(node) ? node.map((element, at) => along(element, rest, `${key}.${at}`, visit)) : node;
  if (!node || typeof node !== "object" || !(segment! in node)) return node;
  const record = node as Record<string, unknown>;
  return { ...record, [segment!]: along(record[segment!], rest, key ? `${key}.${segment}` : segment!, visit) };
}

/** `value` with the arrays at `paths` emptied (`head`), and those arrays by their concrete keys. */
export function splitBounded<T>(value: T, paths: readonly string[]): { head: T; arrays: Array<readonly [string, readonly unknown[]]> } {
  const arrays: Array<readonly [string, readonly unknown[]]> = [];
  let head: unknown = value;
  for (const path of paths) head = along(head, path.split("."), "", (array, key) => { arrays.push([key, array]); return []; });
  return { head: head as T, arrays };
}

/** The inverse of {@link splitBounded} on the receiving thread: the head's arrays at `paths`, followed by their parts. */
export function assembleBounded<T>(head: T, parts: PartsReceiver, paths: readonly string[]): T {
  let value: unknown = head;
  for (const path of paths) {
    value = along(value, path.split("."), "", (array, key) => {
      const arrived = parts.take(key);
      return arrived.length === 0 ? [...array] : array.length === 0 ? arrived : [...array, ...arrived];
    });
  }
  return value as T;
}

/**
 * The worker side in one call: the arrays of `value` at `paths` go as bounded parts; the returned head (those arrays emptied)
 * is what the completing message carries. Throws a {@link TransferOverBudget} like {@link sendParts}; the head counts too.
 */
export function postBounded<T>(post: (part: TransferPart) => void, value: T, paths: readonly string[], limits: TransferLimits = {}): T {
  const { head, arrays } = splitBounded(value, paths);
  sendParts(post, arrays, limits, estimatedBytes(head));
  return head;
}
