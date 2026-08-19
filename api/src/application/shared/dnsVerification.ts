/**
 * Domain-ownership proof over DNS-over-HTTPS — the ONE verifier.
 *
 * Three features need to know "does this tenant actually control this domain?":
 * custom-domain hosting (`application/ide/customDomain.ts`), marketing sender
 * identities (`application/marketing/campaignEngine.ts`) and enterprise SSO
 * routing (`application/auth/enterpriseSso.ts`). All three prove it the same
 * way — the tenant publishes a TXT record containing a token we issued — so the
 * resolver, the token format, the record name and the comparison live here once.
 * A second copy would drift into a second security model.
 *
 * DNS-over-HTTPS (Cloudflare's 1.1.1.1 JSON API) rather than a zone API: it
 * needs no credential, works from a Worker (no UDP), and — critically — proves
 * what the PUBLIC internet resolves, not what our own control plane believes.
 *
 * Everything here is injectable (`fetchImpl`, `now`) so the verifier is unit
 * testable without a network.
 */

/** Public resolver endpoint. Cloudflare's DoH JSON API. */
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/** TXT record name prefixes, one per proof purpose. Kept together so the two
 *  features can never collide on the same record. */
export const CHALLENGE_PREFIX = {
  /** Custom site domain: `_builderforce-challenge.<domain>` */
  site: '_builderforce-challenge',
  /** Marketing sender domain: `_builderforce-sender.<domain>` */
  sender: '_builderforce-sender',
  /** Enterprise SSO routing domain: `_builderforce-sso.<domain>` — the proof that
   *  lets `sso_domains` route every sign-in from an address to one connection.
   *  Its own record name, not `site`'s, because the three grant different things
   *  and one published token must not silently satisfy all of them. */
  sso: '_builderforce-sso',
} as const;

export type ChallengePurpose = keyof typeof CHALLENGE_PREFIX;

/** A hostname is 1–253 chars of dot-separated DNS labels with a real TLD. */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalize a user-typed hostname, or null when it is not one we can host.
 * Accepts a pasted URL, strips scheme/path/port/trailing dot, lowercases, and
 * rejects anything that is not a public-looking hostname.
 */
export function normalizeHostname(raw: string): string | null {
  let value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  // Tolerate a pasted URL rather than making the user strip it.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = (value.split(':')[0] ?? '').replace(/\.$/, '');
  if (!value || !HOSTNAME_RE.test(value)) return null;
  // Reject anything under our own apex — that is a subdomain claim, a different
  // (already-supported) flow, and letting it through here would let a tenant
  // "verify" a platform hostname they do not control.
  if (value === 'builderforce.ai' || value.endsWith('.builderforce.ai')) return null;
  return value;
}

/** The FQDN the tenant must create the TXT record at. */
export function challengeRecordName(purpose: ChallengePurpose, hostname: string): string {
  return `${CHALLENGE_PREFIX[purpose]}.${hostname}`;
}

/** A fresh, URL-safe challenge token. 32 hex chars — collision-free in practice
 *  and short enough to paste into a DNS panel without wrapping. */
export function newChallengeToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Minimal shape of the DoH JSON answer we depend on. */
interface DohAnswer { name?: string; type?: number; data?: string }
interface DohResponse { Status?: number; Answer?: DohAnswer[] }

export interface DnsLookupDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Resolve every TXT string at `name`. Returns `[]` for NXDOMAIN, an empty
 * answer, or any resolver failure — callers treat "no records" and "resolver
 * unreachable" identically (both mean "not proven yet"), so there is no error
 * channel to get wrong.
 *
 * TXT payloads come back quoted and can be split into multiple <=255-byte
 * chunks; both are normalized away here so the caller compares plain strings.
 */
export async function resolveTxtRecords(name: string, deps: DnsLookupDeps = {}): Promise<string[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  let body: DohResponse;
  try {
    const res = await doFetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) return [];
    body = (await res.json()) as DohResponse;
  } catch {
    return [];
  }
  if (!body || !Array.isArray(body.Answer)) return [];
  return body.Answer
    // type 16 = TXT. A CNAME in the chain also comes back in Answer; ignore it.
    .filter((a) => a.type === 16 && typeof a.data === 'string')
    .map((a) => unquoteTxt(a.data as string))
    .filter((v) => v.length > 0);
}

/** Strip the surrounding quotes and join multi-chunk TXT payloads. */
export function unquoteTxt(raw: string): string {
  const chunks = raw.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!chunks) return raw.trim();
  return chunks.map((c) => c.slice(1, -1).replace(/\\"/g, '"')).join('').trim();
}

/** Resolve the CNAME/A targets at `name` — used to check a site's traffic is
 *  actually pointed at us before we ask for a certificate. */
export async function resolveCnameTargets(name: string, deps: DnsLookupDeps = {}): Promise<string[]> {
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=CNAME`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as DohResponse;
    return (body.Answer ?? [])
      .filter((a) => a.type === 5 && typeof a.data === 'string')
      .map((a) => (a.data as string).toLowerCase().replace(/\.$/, ''));
  } catch {
    return [];
  }
}

export interface ChallengeVerification {
  verified: boolean;
  /** The record we looked for — echoed so the UI can show the exact FQDN. */
  recordName: string;
  /** What we actually found, for a "you published the wrong value" message. */
  found: string[];
}

/**
 * Check whether `token` is published as a TXT record for `hostname`.
 *
 * Matches if ANY TXT string at the challenge name equals the token — a domain
 * legitimately carries other TXT records, and a tenant may be mid-rotation with
 * both an old and a new token present.
 */
export async function verifyChallengeToken(
  purpose: ChallengePurpose,
  hostname: string,
  token: string,
  deps: DnsLookupDeps = {},
): Promise<ChallengeVerification> {
  const recordName = challengeRecordName(purpose, hostname);
  if (!token) return { verified: false, recordName, found: [] };
  const found = await resolveTxtRecords(recordName, deps);
  return { verified: found.includes(token), recordName, found };
}

/** The domain part of an email address, lowercased, or null when unparseable. */
export function emailDomain(email: string): string | null {
  const at = String(email ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at <= 0) return null;
  const domain = String(email).trim().toLowerCase().slice(at + 1);
  return HOSTNAME_RE.test(domain) ? domain : null;
}

/** RFC-shaped enough for a send list: one `@`, a parseable domain, length-capped. */
export function isSendableEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const value = email.trim();
  if (value.length < 3 || value.length > 320) return false;
  if (/\s/.test(value)) return false;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return false;
  return emailDomain(value) !== null;
}

/** Canonical storage form for an address: trimmed and lowercased. Suppression,
 *  audience membership and send dedupe all key off this, so it has ONE definition. */
export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}
