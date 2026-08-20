/**
 * UTM OWNERSHIP — the join between what a network CHARGED and what actually arrived.
 *
 * `ad_insights` knows what Meta billed. `/api/measurement/breakdown` knows how many
 * sessions turned up. Nothing joins them, and the obvious join does not work: matching
 * GA4's `sessionCampaignName` to `ad_campaigns.name` is string-shaped, so the first
 * rename splits one campaign's history into two campaigns that each look half as
 * effective, and nobody can tell that is what happened.
 *
 * The fix is to stop MATCHING and start OWNING. This platform mints the campaign tag
 * itself, once, and puts it on the destination URL:
 *
 *   1. {@link utmCampaignFor} derives the tag from the campaign's IMMUTABLE identity
 *      (network + the network's own id), not from its mutable name. The name only
 *      contributes readability. Re-deriving it later produces the same string, and
 *      renaming the campaign cannot produce a different one.
 *   2. It is written ONCE, at create time, and never re-derived — see
 *      `adLedger.upsertAdCampaign`, whose conflict branch deliberately omits the column
 *      even though it refreshes everything else from the network.
 *   3. {@link appendUtmParams} puts it on every destination URL the ads port sets,
 *      without ever clobbering a param the caller wrote themselves.
 *
 * A tag that changes is worse than no tag: no tag reports nothing, while a tag that
 * changed reports a confident wrong number split across two rows.
 */

/** The medium every paid click on this platform is bought under. Fixed, because the
 *  whole point is that one value means "we paid for this" in every analytics tool. */
export const UTM_PAID_MEDIUM = 'cpc';

/** Wide enough for a readable name, short enough that no network truncates the URL. */
const MAX_SLUG = 48;
const MAX_UTM_CAMPAIGN = 120;

/**
 * A URL-safe, lower-case slug. Diacritics are folded rather than stripped, so
 * "München" becomes `munchen` instead of `mnchen` — an analytics tool showing the
 * latter tells you nothing about which campaign it was.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

/**
 * A short, stable digest of the campaign's immutable identity.
 *
 * FNV-1a rather than a crypto hash: this is a COLLISION-AVOIDANCE suffix on a string
 * that already carries the network and the name, not a security boundary, and it must
 * be synchronous — `crypto.subtle.digest` is a promise, and a tag that has to be
 * awaited would push async into every call site that builds a URL.
 */
function shortDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, by shift-and-add: a 32-bit multiply overflows a JS number's
    // integer range and would silently stop being FNV.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(0, 7);
}

/**
 * The tag for one campaign. Deterministic, and stable across every rename.
 *
 * The name is in there for a person reading a GA4 report; the digest is what makes it
 * unique and what makes it survive. Two campaigns with the same name on the same
 * network are different campaigns with different external ids, so they get different
 * tags — which is exactly the distinction the string-matching approach loses.
 */
export function utmCampaignFor(network: string, externalId: string, name: string): string {
  const label = slugify(name) || slugify(network) || 'campaign';
  return `${label}-${shortDigest(`${network}:${externalId}`)}`.slice(0, MAX_UTM_CAMPAIGN);
}

/** The three params a paid click carries. `utm_content` is added by the caller when it
 *  has an ad set or ad to name — the rollup groups on `utm_campaign` alone. */
export function utmParamsFor(network: string, utmCampaign: string): Record<string, string> {
  return {
    utm_source: slugify(network) || 'paid',
    utm_medium: UTM_PAID_MEDIUM,
    utm_campaign: utmCampaign,
  };
}

/**
 * Put the tag on a destination URL.
 *
 * Three things it must not do, each of which is a real way this goes wrong:
 *
 *   • DOUBLE-APPEND. Running twice — a retry, a re-publish, an edit — must produce the
 *     same URL, not `?utm_campaign=x&utm_campaign=x`. Analytics tools disagree about
 *     which repeated param wins, so the same click is attributed differently by two
 *     tools looking at the same URL.
 *   • CLOBBER. If the caller wrote their own `utm_source`, that is a decision, not an
 *     accident; ours yields. Overwriting it would silently rewrite an existing
 *     attribution scheme the moment this feature shipped.
 *   • MANGLE. An existing query string and an existing fragment both survive — a
 *     fragment appended AFTER the query is the difference between a working deep link
 *     and a 404 that only happens on paid traffic.
 *
 * A URL this cannot parse is returned UNCHANGED rather than guessed at: an untagged
 * click is a gap in a report, while a corrupted destination is a click that costs money
 * and lands nowhere.
 */
export function appendUtmParams(url: string, params: Record<string, string>): string {
  const raw = (url ?? '').trim();
  if (!raw) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }
  // Only http(s) destinations are tagged. A mailto: or app link has no query semantics
  // an analytics tool reads, so tagging it is noise at best.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;

  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    if (parsed.searchParams.has(key)) continue;
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

/** The tag already on a URL, if any — so a caller can tell "untagged" from "tagged by
 *  someone else" instead of treating both as missing. */
export function utmCampaignOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('utm_campaign');
  } catch {
    return null;
  }
}
