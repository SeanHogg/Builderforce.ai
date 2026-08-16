/**
 * The published site's HTTP conventions — the envelope, the CORS posture, and
 * how a submission is read.
 *
 * ── WHY THESE ARE A MODULE AND NOT THREE PRIVATE FUNCTIONS ───────────────────
 * They used to be private to `siteServer.ts`, which was correct while that file
 * held every `/__api/…` handler. It no longer does: the billing handlers moved
 * to `application/marketplace/siteBilling.ts`, where the money belongs, and they
 * must answer in EXACTLY the same envelope as the datastore and the auth
 * endpoints — same `content-type`, same open CORS, same tolerance of a plain
 * `<form>` post. A second copy over there is how one endpoint starts replying
 * with a shape a published page's `fetch()` cannot read.
 *
 * Extracting them also keeps the import direction one-way: the billing module
 * reaches into `ide/` for the site's conventions, and `siteServer.ts` does not
 * reach back for the money.
 */

/**
 * Deliberately open.
 *
 * A form posted from the site itself is same-origin, but a static export hosted
 * elsewhere is a legitimate caller too, and the write endpoint can only ever
 * CREATE a record in one collection. Cross-origin access to a project's own
 * HANDLERS is a different question and stays opt-in per handler (`cors` on the
 * spec) — see `serveSiteBackend`, which deliberately does NOT use this.
 */
export function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

/** The one JSON envelope every `/__api/…` endpoint answers in. */
export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...extraHeaders },
  });
}

/** Accept both JSON and classic HTML form encodings, so a plain `<form>` with no
 *  JavaScript works exactly as well as a `fetch()`. Returns null when the body
 *  could not be read at all, which every caller reports as a 400. */
export async function readSubmission(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('application/json')) return await request.json();
    if (type.includes('form')) {
      const form = await request.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) out[k] = typeof v === 'string' ? v : (v as File).name;
      return out;
    }
    // No content-type (or an odd one) — try JSON, then give up.
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}
