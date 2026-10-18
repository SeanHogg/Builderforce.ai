/**
 * The ONE transport this package needs: an authenticated JSON call against the gateway.
 *
 * Each host already owns its credential and its error vocabulary — the editor's
 * `authedRaw`, Rovr's API client, the web app's `request` — so the package never sees a
 * key. What it does need is the STATUS, because every decision here turns on it (a 404
 * means "connect first", a 409 "reconnect", a 200 "here is your token"), so the port
 * returns it rather than throwing on a non-2xx. It throws only when there was no answer
 * at all (offline, signed out), which every caller treats as "try again later".
 */
export interface GatewayRequest {
  (path: string, init?: { method?: 'GET' | 'POST'; json?: unknown }): Promise<{ status: number; body: unknown }>;
}

/** A field off an untyped JSON body, or undefined. */
export function field(body: unknown, key: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

export function stringField(body: unknown, key: string): string {
  const value = field(body, key);
  return typeof value === 'string' ? value : '';
}

/** The gateway's error sentence (`{error:"…"}` or `{error:{message}}`), for a failure detail. */
export function errorDetail(body: unknown, status: number): string {
  const error = field(body, 'error');
  if (typeof error === 'string' && error) return error;
  const nested = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof nested === 'string' && nested ? nested : `HTTP ${status}`;
}
