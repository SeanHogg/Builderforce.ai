import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Publisher domain verification — the half of the claim that was never performed.
 *
 * `beginDomainVerification` has always issued the challenge: it stores a token and
 * tells the publisher to publish `_builderforce.<domain>  TXT  bfdev-verify-…`.
 * Nothing then LOOKED. Promotion past `unverified` was `setPublisherState`, an
 * operator action in an admin route — so a vendor who had done exactly what they
 * were asked sat unverified until a human noticed, and "self-serve publisher
 * onboarding" stopped one step short of being self-serve.
 *
 * ── HOW THE LOOKUP HAPPENS ──────────────────────────────────────────────────
 * Workers have no DNS resolver, so this uses DNS-over-HTTPS (RFC 8484's JSON
 * profile) against Cloudflare's public resolver — one GET, no binding, no
 * credential. A TXT answer arrives quoted and may be split into 255-byte strings,
 * so the comparison strips quotes and rejoins the parts before matching.
 *
 * ── WHAT IT IS ALLOWED TO DO ────────────────────────────────────────────────
 * Exactly one transition: `unverified` → `domain_verified`, and only when the
 * token matches. It never promotes to `identity_verified` (that is a human
 * judgement about who a company IS, which no DNS record can answer) and it never
 * DEMOTES: a publisher who has already earned domain verification and later
 * rotates their DNS is a support conversation, not a silent loss of standing —
 * and a resolver hiccup must never be able to unpublish somebody's extensions.
 *
 * The state transition itself stays in `publishers.setPublisherState`, which is
 * why this module ends by calling it rather than writing the column.
 */
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { tenants } from '../../infrastructure/database/schema';
import { setPublisherState } from './publishers';
import type { Env } from '../../env';

/** The subdomain the challenge record lives on. One definition, two consumers:
 *  the instruction the publisher is given and the name this looks up. */
export function challengeRecordName(domain: string): string {
  return `_builderforce.${domain}`;
}

/** DNS-over-HTTPS JSON answer (only the fields this needs). */
interface DohAnswer { data?: string }
interface DohResponse { Status?: number; Answer?: DohAnswer[] }

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

/**
 * Normalize one TXT answer to the string the zone owner typed.
 *
 * A TXT record is transported as one or more quoted character-strings, each at
 * most 255 bytes, and resolvers hand them back as `"part1" "part2"`. Comparing
 * the raw answer to the token would fail on any record long enough to be split
 * (ours is 33 characters, but a zone that appends anything makes it so) and on
 * every record at all, because of the quotes.
 */
export function normalizeTxt(raw: string): string {
  return raw
    .split(/"\s+"/)
    .join('')
    .replace(/^"/, '')
    .replace(/"$/, '')
    .trim();
}

export type DomainCheckOutcome = 'verified' | 'not_found' | 'lookup_failed';

/**
 * Does `domain` publish the expected challenge token?
 *
 * `lookup_failed` and `not_found` are deliberately different answers: a resolver
 * that is unreachable says nothing about the publisher, and treating the two the
 * same is how a transient outage turns into "your domain is not verified".
 */
export async function checkDomainToken(
  domain: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DomainCheckOutcome> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(challengeRecordName(domain))}&type=TXT`;
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { accept: 'application/dns-json' } });
  } catch {
    return 'lookup_failed';
  }
  if (!response.ok) return 'lookup_failed';

  const body = (await response.json().catch(() => null)) as DohResponse | null;
  if (!body) return 'lookup_failed';
  // Status 3 is NXDOMAIN — an authoritative "there is no such record", which is a
  // real not_found. Any other non-zero status is the resolver failing, not the zone.
  if (body.Status != null && body.Status !== 0 && body.Status !== 3) return 'lookup_failed';

  const answers = (body.Answer ?? []).map((a) => normalizeTxt(a.data ?? ''));
  return answers.includes(token) ? 'verified' : 'not_found';
}

export interface DomainVerificationResult {
  outcome: DomainCheckOutcome | 'no_claim' | 'already_verified';
  /** The state the publisher is in after this call. */
  state: string;
}

/**
 * Check ONE publisher's claim and promote it when the record is live.
 *
 * Idempotent and safe to call from anywhere — the sweep, and the portal's "check
 * now" button, are the same call. A publisher already at or above
 * `domain_verified` is left exactly as it is.
 */
export async function verifyPublisherDomain(
  db: Db,
  env: Env,
  tenantId: number,
  fetchFn: typeof fetch = fetch,
): Promise<DomainVerificationResult> {
  const [row] = await db
    .select({
      state: tenants.publisherState,
      domain: tenants.publisherDomain,
      token: tenants.publisherVerificationToken,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) return { outcome: 'no_claim', state: 'none' };
  if (row.state !== 'unverified') return { outcome: 'already_verified', state: row.state };
  if (!row.domain || !row.token) return { outcome: 'no_claim', state: row.state };

  const outcome = await checkDomainToken(row.domain, row.token, fetchFn);
  if (outcome !== 'verified') return { outcome, state: row.state };

  const promoted = await setPublisherState(db, env, { tenantId, state: 'domain_verified' });
  return { outcome: 'verified', state: promoted.state as string };
}

export interface PublisherDomainSweepResult {
  pending: number;
  verified: number;
  errors: number;
}

/** Max claims checked per tick — one DoH request each, so this bounds the sweep. */
const MAX_CLAIMS_PER_TICK = 50;

/**
 * Check every outstanding domain claim and promote the ones whose record is live.
 *
 * The candidate set is narrow by construction — a workspace only appears while it
 * is `unverified` WITH a claimed domain and an issued token — so a platform with
 * no pending claims does one indexed query and stops. Each claim is isolated: an
 * unreachable zone cannot stop the next publisher being verified.
 */
export async function runPublisherDomainSweep(env: Env): Promise<PublisherDomainSweepResult> {
  const db = buildDatabase(env as unknown as Parameters<typeof buildDatabase>[0]);
  const pending = await db
    .select({ id: tenants.id, domain: tenants.publisherDomain })
    .from(tenants)
    .where(and(
      eq(tenants.publisherState, 'unverified'),
      isNotNull(tenants.publisherDomain),
      isNotNull(tenants.publisherVerificationToken),
      ne(tenants.publisherDomain, ''),
    ))
    .limit(MAX_CLAIMS_PER_TICK);

  let verified = 0;
  let errors = 0;
  for (const claim of pending) {
    try {
      const result = await verifyPublisherDomain(db, env, claim.id);
      if (result.outcome === 'verified') verified++;
    } catch (e) {
      errors++;
      reportCaughtError(e, {
        source: 'application/developer/domainVerification.ts',
        operation: 'runPublisherDomainSweep',
        context: { logMessage: `[cron:publisher-domains] claim for tenant ${claim.id} (${claim.domain}) failed`, details: e },
      });
    }
  }
  return { pending: pending.length, verified, errors };
}
