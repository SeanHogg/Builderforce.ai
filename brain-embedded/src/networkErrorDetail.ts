/**
 * The REASON behind a network failure, read off its `cause` chain.
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
  const push = (part: string): void => {
    if (part && !parts.includes(part)) parts.push(part);
  };
  let current: unknown = e;
  for (let depth = 0; current !== undefined && current !== null && depth < MAX_DEPTH; depth++) {
    // An AggregateError's own message is often empty; its entries are the reason.
    if (current instanceof AggregateError && current.errors.length > 0) {
      push(current.errors.map(describeOne).filter((s, i, all) => all.indexOf(s) === i).join(' | '));
    } else {
      push(describeOne(current));
    }
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.join(' ← ');
}
