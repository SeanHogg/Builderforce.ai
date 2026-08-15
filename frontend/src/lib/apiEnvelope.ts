/**
 * The one reader of this API's error envelope.
 *
 * Routes in the api worker answer failures as `{ error: string }` with a non-2xx
 * status, so every typed client needs the same three lines: check `ok`, pull the
 * envelope's message, fall back to something human when the body isn't JSON. That
 * is a single fact about the wire format, and it belongs in one place — when it
 * lived in each client, a fix to one copy silently left the others reporting
 * "Failed to load" over a perfectly good server message.
 *
 * Pair it with `apiRequestStream` (not `apiRequest`): the caller wants the raw
 * Response so it can decide between this, `.blob()`, or a stream.
 */
export async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return res.json() as Promise<T>;
}
