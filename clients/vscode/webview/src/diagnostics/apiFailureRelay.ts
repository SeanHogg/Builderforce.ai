/**
 * Relay every failed API answer the webview receives to the extension host, which
 * writes it to the BuilderForce output channel.
 *
 * WHY. The webview calls the API directly (`authedFetch`, the chat persistence, the
 * canvas clients), so its failures never pass through the host — and a webview's
 * console is not somewhere anyone looks. A 500 during a chat send put "Something went
 * wrong on our side" in the banner and left the output channel EMPTY for the exact
 * failure the user was looking at: no endpoint, no status, nothing to quote. The API
 * now answers every 5xx with a reference its stored error row shares; this is what
 * puts that reference, the method and the path somewhere a user can copy them from.
 *
 * ONE hook, on `fetch` itself, rather than a line in each client: there are several
 * independent API clients in this bundle, and a relay any of them can forget to call
 * is a relay that is missing for whichever failure matters next. It only OBSERVES —
 * the response is returned untouched, and the body is read from a clone.
 */

export interface ApiFailure {
  method: string;
  /** Path only — never the query string, which can carry ids a log should not. */
  path: string;
  status: number;
  /** The API's own sentence, when the body carried one (truncated). */
  error?: string;
  /** The 5xx reference the API's stored error row carries. */
  errorId?: string;
}

const MAX_ERROR_CHARS = 300;

/** Read the failure a non-2xx response describes, from a clone so the caller's body is untouched. */
export async function describeApiFailure(input: RequestInfo | URL, init: RequestInit | undefined, res: Response): Promise<ApiFailure> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://webview.invalid');
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const failure: ApiFailure = { method, path: url.pathname, status: res.status };
  try {
    const body = JSON.parse(await res.clone().text()) as { error?: unknown; message?: unknown; errorId?: unknown };
    const said = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : undefined;
    if (said) failure.error = said.slice(0, MAX_ERROR_CHARS);
    if (typeof body.errorId === 'string') failure.errorId = body.errorId;
  } catch {
    // Not JSON (an edge/proxy page, an empty body) — the status and path are the record.
  }
  return failure;
}

/**
 * Wrap `target.fetch` so every non-2xx answer is handed to `report`. Idempotent: a
 * second install (a hot reload, a test) does not double-wrap.
 */
export function installApiFailureRelay(report: (failure: ApiFailure) => void, target: { fetch: typeof fetch } = globalThis): void {
  const current = target.fetch as typeof fetch & { __apiFailureRelay?: true };
  if (!current || current.__apiFailureRelay) return;
  // Bound: a browser's `fetch` called with any other `this` throws "Illegal invocation".
  const original = current.bind(target);
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (!res.ok) {
      // Never let the relay itself become a failure the caller sees.
      describeApiFailure(input, init, res).then(report, () => undefined);
    }
    return res;
  }) as typeof fetch & { __apiFailureRelay?: true };
  wrapped.__apiFailureRelay = true;
  target.fetch = wrapped;
}
