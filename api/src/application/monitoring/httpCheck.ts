/**
 * ASKING A URL WHETHER IT IS HEALTHY — the platform's one implementation.
 *
 * ── WHY IT IS A MODULE AND NOT A BRANCH IN A SWITCH ──────────────────────────────
 * This rule lived inside `MonitoringService.evaluateMonitor`'s `http_check` case,
 * where it was correct and reachable only by passing a PERSISTED `monitors` row. Two
 * callers need it and only one of them has a row:
 *
 *   the monitor sweep   evaluates a stored monitor every five minutes, opens an
 *                       incident on breach, pages on-call.
 *   Stage               asks a hosted listing's address ONE question, before
 *                       anything is for sale, for a seller who is watching a
 *                       spinner. Answering it by writing a `sev2` monitor row would
 *                       page an on-call engineer every time somebody pressed Stage
 *                       on a half-finished app.
 *
 * The second caller was assembling an in-memory row and casting it, which is a type
 * lie that stays true only while the branch reads nothing but `monitorType` and
 * `config`. Extracting the rule removes the cast and leaves ONE definition of "is
 * this URL healthy" — the thing that actually matters, because a second copy would
 * agree with the first until the day one of them changed.
 *
 * ── WHY THE ASSERTION IS NOT A STATUS CODE ───────────────────────────────────────
 * A status code is not enough on either side. A Function URL whose Lambda has been
 * deleted can still answer 200 from an edge, and a Cloud Run revision that failed to
 * start answers 503 through a load balancer that is itself perfectly healthy. So
 * `bodyMatch` exists: a marker only the thing being watched can emit.
 */

/** What a check is allowed to ask. The same field names `monitors.config` stores,
 *  because a monitor row IS one of these plus scheduling. */
export interface HttpCheckConfig {
  url?: string;
  /** Default GET. */
  method?: string;
  /** Default: any 2xx. */
  expectedStatus?: number;
  headers?: Record<string, string>;
  /** Substring the body must contain to count as healthy. */
  bodyMatch?: string;
}

/**
 * `unknown` means NOT ASKED — there was no url to ask. It is deliberately distinct
 * from `breach`, because "we have no target" and "the target is down" call for
 * opposite responses: the first is a configuration gap, the second is an incident.
 */
export type HttpCheckResult = 'ok' | 'breach' | 'unknown';

export async function httpCheck(config: HttpCheckConfig): Promise<HttpCheckResult> {
  if (!config.url) return 'unknown';
  try {
    const method = (config.method ?? 'GET').toUpperCase();
    const headers = config.headers && Object.keys(config.headers).length ? config.headers : undefined;
    const res = await fetch(config.url, { method, redirect: 'follow', ...(headers ? { headers } : {}) });
    const okStatus = config.expectedStatus != null ? res.status === config.expectedStatus : res.ok;
    if (!okStatus) return 'breach';
    // Optional content assertion: the response body must contain a marker (e.g. a
    // health endpoint that answers 200 and reports "degraded").
    const wanted = config.bodyMatch?.trim();
    if (wanted) {
      const text = await res.text().catch(() => '');
      return text.includes(wanted) ? 'ok' : 'breach';
    }
    return 'ok';
  } catch {
    // Unreachable IS a breach: from the caller's side there is no difference between
    // "DNS does not resolve" and "the service is down", and both mean the address
    // somebody is pointed at is not serving. Never rethrown — a sweep that threw on
    // the first dead host would stop checking the rest of them.
    return 'breach';
  }
}
