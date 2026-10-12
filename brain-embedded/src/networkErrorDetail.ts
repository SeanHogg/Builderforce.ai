/**
 * The REASON behind a network failure, read off its `cause` chain — and what to do
 * about the one kind that is always safe to retry.
 *
 * Node's fetch (undici) throws `TypeError('fetch failed')` and a broken body read
 * throws `TypeError('terminated')` — both say nothing on their own. What went wrong
 * lives in `cause`: `UND_ERR_HEADERS_TIMEOUT`, `ECONNRESET`, `ENOTFOUND`,
 * `UND_ERR_SOCKET: other side closed`, a TLS failure, or an `AggregateError` with one
 * entry per address tried. Reporting only the outer message turned every one of those
 * into the same "fetch failed: fetch failed" on the timeline, with nothing to act on.
 *
 * Output is the outer message followed by each distinct cause, code first:
 * `fetch failed ← UND_ERR_HEADERS_TIMEOUT: Headers Timeout Error`.
 */

/** How deep the chain is followed — undici nests at most two or three. */
const MAX_DEPTH = 4;

/** Every error in `e`'s cause chain, an AggregateError's entries flattened in place. */
function causeChain(e: unknown): unknown[][] {
  const levels: unknown[][] = [];
  let current: unknown = e;
  for (let depth = 0; current !== undefined && current !== null && depth < MAX_DEPTH; depth++) {
    // An AggregateError's own message is often empty; its entries are the reason.
    levels.push(current instanceof AggregateError && current.errors.length > 0 ? current.errors : [current]);
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return levels;
}

function describeOne(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: unknown }).code;
  const message = e.message.trim();
  if (!message) return typeof code === 'string' && code ? code : e.name;
  // Node's own messages often lead with the code already (`read ECONNRESET`); undici's don't.
  return typeof code === 'string' && code && !message.includes(code) ? `${code}: ${message}` : message;
}

export function describeNetworkError(e: unknown): string {
  const parts: string[] = [];
  for (const level of causeChain(e)) {
    const part = level.map(describeOne).filter((s, i, all) => all.indexOf(s) === i).join(' | ');
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(' ← ');
}

/** Codes that mean the connection was never OPENED — nothing reached the server. */
const NEVER_CONNECTED = new Set([
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Did this request fail before a connection was ever opened?
 *
 * Then no byte reached the server, so sending it again is safe whatever it does —
 * a write included. That is what a network drop on the user's side looks like
 * (chat #141/#142: `connect ETIMEDOUT` on every Cloudflare address at once, in every
 * run in the same second). `ETIMEDOUT` counts only on the `connect` syscall: the same
 * code on an open socket means the request may already be in flight.
 */
export function isConnectFailure(e: unknown): boolean {
  return causeChain(e).some((level) => level.some((err) => {
    const { code, syscall } = (err ?? {}) as { code?: unknown; syscall?: unknown };
    return typeof code === 'string' && (NEVER_CONNECTED.has(code) || (code === 'ETIMEDOUT' && syscall === 'connect'));
  }));
}

/**
 * Pauses between attempts when the connection could not be opened: about half a minute
 * in all, long enough to ride out a Wi-Fi or VPN drop, short enough that a machine that
 * is really offline hears so.
 */
export const CONNECT_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000];

export interface ConnectRetryOptions {
  signal?: AbortSignal;
  delaysMs?: readonly number[];
  /** Told before each wait — the caller's chance to say the run is waiting on the network. */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject(signal!.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `send`, and send again with backoff while the connection cannot be opened. Any
 * other failure — a reset mid-request, a timeout on an open socket, an HTTP error — is
 * rethrown at once: the request may have arrived, and only the caller knows whether
 * repeating it is safe. A Stop during a wait rejects with the abort reason.
 */
export async function retryOnConnectFailure<T>(send: () => Promise<T>, opts: ConnectRetryOptions = {}): Promise<T> {
  const delays = opts.delaysMs ?? CONNECT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (e) {
      // A Stop is a Stop, whatever the network was doing when it came.
      if (opts.signal?.aborted) throw opts.signal.reason ?? e;
      if (attempt >= delays.length || !isConnectFailure(e)) throw e;
      const delay = delays[attempt]!;
      opts.onRetry?.(attempt + 1, delay, describeNetworkError(e));
      await pause(delay, opts.signal);
    }
  }
}
