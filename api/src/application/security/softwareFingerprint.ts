/**
 * softwareFingerprint — the PURE half of the CVE stage: which software, at which
 * version, is this site actually running, and which published advisories affect it?
 *
 * TWO HALVES, ONE OF WHICH NEEDS NOTHING
 * The header check already flags "you disclose a version" (`version-disclosure`).
 * That is a hygiene finding — it says a string is present, not that the string is
 * dangerous. Turning `nginx/1.18.0` into "and 1.18.0 is affected by CVE-…" needs an
 * advisory feed, which is a paid external subscription this deployment may not hold.
 *
 * The half that needs no subscription is the fingerprinting itself, and it is built
 * in full here: `Server`, `X-Powered-By`, framework version headers, `<meta
 * name="generator">`, and versioned asset URLs are parsed into normalised
 * `{product, version}` pairs. The half that does need a feed is reached through the
 * {@link ./advisoryFeed} PORT, whose default adapter performs no lookup and SAYS SO.
 * That distinction is the point: a scan with no feed configured reports the
 * fingerprints it found and states that the advisory lookup did not happen. It never
 * reports "no CVEs found", which is a claim it has not earned and which a reader
 * would take as an all-clear.
 *
 * Everything in this file is pure: strings in, findings out. The HTTP fetch that
 * produced those strings happens at the container edge; the version-range comparison
 * that decides whether an advisory applies is the highest-risk logic in the stage
 * (an off-by-one in a range comparison either hides a real CVE or invents one), so it
 * is a plain exported function with its own tests.
 */
import { makeWebFinding, type ScanContext, type WebFinding } from './WebSecurityScanner';
import type { FindingSeverity } from './SecurityAuditService';

/** Where a fingerprint was observed — carried into the finding as evidence. */
export type FingerprintSource =
  | 'server-header'
  | 'powered-by-header'
  | 'framework-header'
  | 'generator-meta'
  | 'asset-path';

/** One identified piece of software running on the scanned site. */
export interface SoftwareFingerprint {
  /** Normalised product key, lowercase, e.g. `nginx`, `php`, `wordpress`. */
  product: string;
  /** Dotted version exactly as observed, e.g. `1.18.0`. */
  version: string;
  source: FingerprintSource;
  /** The raw string it was read from, so a false positive is diagnosable. */
  evidence: string;
}

/** The observation the fingerprinter reads. Produced by the container edge. */
export interface FingerprintInput {
  /** Lowercased response header name → value. */
  headers: Record<string, string>;
  /** A bounded slice of the HTML body (may be empty). */
  body: string;
}

/**
 * Vendor spellings folded onto one key. Feeds and humans disagree wildly here
 * (`Microsoft-IIS`, `IIS`, `iis`), and a fingerprint that does not normalise cannot
 * be matched against an advisory list without the mismatch looking like "no CVEs".
 */
const PRODUCT_ALIASES: Record<string, string> = {
  'microsoft-iis': 'iis',
  'iis': 'iis',
  'apache': 'apache',
  'apache-coyote': 'tomcat',
  'nginx': 'nginx',
  'openresty': 'openresty',
  'litespeed': 'litespeed',
  'lighttpd': 'lighttpd',
  'php': 'php',
  'asp.net': 'asp.net',
  'aspnet': 'asp.net',
  'express': 'express',
  'wordpress': 'wordpress',
  'drupal': 'drupal',
  'joomla': 'joomla',
  'joomla!': 'joomla',
  'typo3': 'typo3',
  'ghost': 'ghost',
  'jquery': 'jquery',
  'bootstrap': 'bootstrap',
  'openssl': 'openssl',
  'tomcat': 'tomcat',
  'jetty': 'jetty',
  'gunicorn': 'gunicorn',
  'werkzeug': 'werkzeug',
  'phusion passenger': 'passenger',
  'passenger': 'passenger',
  'next.js': 'next.js',
  'nuxt': 'nuxt',
};

/** Fold a vendor's spelling of a product name onto its canonical key. */
export function normalizeProduct(raw: string): string {
  const key = raw.trim().toLowerCase();
  return PRODUCT_ALIASES[key] ?? key.replace(/\s+/g, '-');
}

/** A version-looking token: at least `N.N`, so a bare major (`Drupal 9`) is skipped —
 *  a major-only "version" matches every advisory range and is worse than no data. */
const VERSION_RE = /\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?/;

/** `<product>/<version>` or `<product> <version>` pairs inside one header value. */
const PAIR_RE = /([A-Za-z][A-Za-z0-9_.!+-]*)[\s/]v?(\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?)/g;

/** Extract every `product/version` pair from one header-ish string. */
function pairsFrom(value: string, source: FingerprintSource): SoftwareFingerprint[] {
  const out: SoftwareFingerprint[] = [];
  for (const m of value.matchAll(PAIR_RE)) {
    const product = normalizeProduct(m[1]!);
    // A one-character or purely numeric "product" is a parse artefact of something
    // like `(Ubuntu) 1.2` — dropping it keeps the noise out of the advisory lookup.
    if (product.length < 2 || /^\d+$/.test(product)) continue;
    out.push({ product, version: m[2]!, source, evidence: value.slice(0, 200) });
  }
  return out;
}

/**
 * Fingerprint every product+version the response discloses. PURE.
 *
 * Deliberately conservative: only strings that carry an explicit dotted version are
 * emitted. "There is a version here" is what makes the finding actionable, and a
 * guess ("this smells like WordPress") would be matched against an advisory list and
 * turned into a CVE claim about software the site may not even run.
 */
export function fingerprintSoftware(input: FingerprintInput): SoftwareFingerprint[] {
  const h = input.headers ?? {};
  const out: SoftwareFingerprint[] = [];

  const server = h['server'];
  if (server) out.push(...pairsFrom(server, 'server-header'));

  const poweredBy = h['x-powered-by'];
  if (poweredBy) out.push(...pairsFrom(poweredBy, 'powered-by-header'));

  // Framework version headers carry a bare version with the product in the NAME.
  const frameworkHeaders: Array<[string, string]> = [
    ['x-aspnet-version', 'asp.net'],
    ['x-aspnetmvc-version', 'asp.net-mvc'],
    ['x-drupal-cache-tags', 'drupal'],
    ['x-litespeed-cache', 'litespeed'],
  ];
  for (const [name, product] of frameworkHeaders) {
    const value = h[name];
    if (!value) continue;
    const m = VERSION_RE.exec(value);
    if (m) out.push({ product, version: m[0], source: 'framework-header', evidence: `${name}: ${value.slice(0, 120)}` });
  }

  // `X-Generator` / `<meta name="generator">` — the CMS naming itself.
  const generatorHeader = h['x-generator'];
  if (generatorHeader) out.push(...pairsFrom(generatorHeader, 'generator-meta'));

  const body = input.body ?? '';
  if (body) {
    for (const m of body.matchAll(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/gi)) {
      out.push(...pairsFrom(m[1]!, 'generator-meta'));
    }
    // `content` before `name` is equally valid HTML and equally common.
    for (const m of body.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/gi)) {
      out.push(...pairsFrom(m[1]!, 'generator-meta'));
    }
    // Versioned asset URLs: `/js/jquery-3.5.1.min.js`, `…/bootstrap.min.css?ver=4.4.1`.
    for (const m of body.matchAll(/["'][^"']*\/([A-Za-z][A-Za-z0-9_.-]*?)[-.@](\d+\.\d+(?:\.\d+)*)(?:\.min)?\.(?:js|css)["']/gi)) {
      const product = normalizeProduct(m[1]!.replace(/\.(min|slim|bundle)$/i, ''));
      if (product.length < 2) continue;
      out.push({ product, version: m[2]!, source: 'asset-path', evidence: m[0]!.slice(1, 200) });
    }
  }

  return dedupeFingerprints(out);
}

/** One row per product+version — the same library referenced by ten `<script>` tags
 *  is one fact, and ten copies of it would be looked up (and billed) ten times. */
export function dedupeFingerprints(fps: SoftwareFingerprint[]): SoftwareFingerprint[] {
  const seen = new Map<string, SoftwareFingerprint>();
  for (const fp of fps) {
    const key = `${fp.product}@${fp.version}`;
    if (!seen.has(key)) seen.set(key, fp);
  }
  return [...seen.values()];
}

// ── Version comparison ────────────────────────────────────────────────────────

/**
 * Compare two dotted versions: negative when `a < b`, 0 when equal, positive when
 * `a > b`. Numeric segments compare NUMERICALLY (so `1.10 > 1.9`, the classic
 * lexicographic bug that silently misses every advisory in a double-digit minor),
 * a missing segment counts as 0 (`1.2` === `1.2.0`), and a pre-release suffix
 * orders BELOW the same release (`2.0.0-rc.1` < `2.0.0`, per semver) because a
 * release candidate contains the vulnerability the final release fixed.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): { nums: number[]; pre: string | null } => {
    const [core, ...rest] = v.trim().replace(/^v/i, '').split(/[-+]/);
    return {
      nums: (core ?? '').split('.').map((p) => Number.parseInt(p, 10)).map((n) => (Number.isNaN(n) ? 0 : n)),
      pre: rest.length > 0 ? rest.join('-') : null,
    };
  };
  const av = split(a);
  const bv = split(b);
  const len = Math.max(av.nums.length, bv.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (av.nums[i] ?? 0) - (bv.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (av.pre === bv.pre) return 0;
  if (av.pre == null) return 1;   // release > pre-release
  if (bv.pre == null) return -1;
  return av.pre < bv.pre ? -1 : 1;
}

/** A half-open affected range, in the shape every modern advisory feed publishes. */
export interface AdvisoryRange {
  /** First affected version, inclusive. Absent ⇒ affected from the beginning. */
  introduced?: string;
  /** First FIXED version, exclusive — the version that is NOT affected. */
  fixed?: string;
  /** Last affected version, inclusive. Used by feeds that publish no fix. */
  lastAffected?: string;
}

/** One published advisory about one product. */
export interface Advisory {
  /** Feed identifier, e.g. `CVE-2021-23017` / `GHSA-…`. */
  id: string;
  /** Normalised product key this advisory is about (see {@link normalizeProduct}). */
  product: string;
  summary: string;
  severity: FindingSeverity;
  ranges: AdvisoryRange[];
  /** Optional advisory URLs for the ticket body. */
  references?: string[];
}

/**
 * Does `version` fall inside `range`? The half-open `[introduced, fixed)` convention
 * is what the feeds publish and is the whole reason this is a named, tested function:
 * treating `fixed` as inclusive marks every patched site as vulnerable, and treating
 * `introduced` as exclusive lets the first affected release through unflagged.
 */
export function versionInRange(version: string, range: AdvisoryRange): boolean {
  if (range.introduced && compareVersions(version, range.introduced) < 0) return false;
  if (range.fixed && compareVersions(version, range.fixed) >= 0) return false;
  if (range.lastAffected && compareVersions(version, range.lastAffected) > 0) return false;
  // A range with no bounds at all affects nothing — an unbounded "everything is
  // vulnerable" claim is always a feed parsing failure, never a real advisory.
  return Boolean(range.introduced || range.fixed || range.lastAffected);
}

/** True when any of the advisory's ranges covers `version`. */
export function advisoryAffects(version: string, advisory: Advisory): boolean {
  return advisory.ranges.some((r) => versionInRange(version, r));
}

/** Pair each fingerprint with the advisories that actually affect its version. PURE. */
export function matchAdvisories(
  fingerprints: SoftwareFingerprint[],
  advisories: Advisory[],
): Array<{ fingerprint: SoftwareFingerprint; advisories: Advisory[] }> {
  const out: Array<{ fingerprint: SoftwareFingerprint; advisories: Advisory[] }> = [];
  for (const fp of fingerprints) {
    const hits = advisories.filter((a) => a.product === fp.product && advisoryAffects(fp.version, a));
    if (hits.length > 0) out.push({ fingerprint: fp, advisories: hits });
  }
  return out;
}

/** Severity order for picking the worst advisory in a group. */
const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

/** The most severe severity in a list; `medium` when the feed rated none of them —
 *  an unrated advisory is still a real advisory and must not sink to `info`. */
export function worstSeverity(advisories: Advisory[]): FindingSeverity {
  let worst: FindingSeverity = 'medium';
  let rank = 0;
  for (const a of advisories) {
    const r = SEVERITY_RANK[a.severity] ?? 0;
    if (r > rank) { rank = r; worst = a.severity; }
  }
  return worst;
}

/** What the advisory port returned for a set of fingerprints. */
export interface AdvisoryLookupOutcome {
  /** False when NO lookup happened (no feed configured / the feed errored). */
  performed: boolean;
  /** The feed that answered (or the null feed's id). */
  feedId: string;
  /** Why no lookup happened. Always set when `performed` is false. */
  reason?: string;
  advisories: Advisory[];
}

/**
 * Turn fingerprints + a lookup outcome into findings. PURE.
 *
 * Three distinct outcomes, and the difference between them is the point:
 *   • lookup performed, matches found  → one finding per affected product, severity
 *     from the worst advisory, CVE ids in the body;
 *   • lookup performed, nothing matched → NO finding. The stage ran and the software
 *     is clean; penalising the score for that would be wrong;
 *   • lookup NOT performed             → one `info` finding listing what was
 *     fingerprinted and stating plainly that no advisory lookup ran. Reporting
 *     silence as "no CVEs" is the failure this branch exists to prevent.
 */
export function evaluateCveFindings(
  ctx: ScanContext,
  fingerprints: SoftwareFingerprint[],
  outcome: AdvisoryLookupOutcome,
): WebFinding[] {
  const out: WebFinding[] = [];

  if (!outcome.performed) {
    if (fingerprints.length === 0) return out; // nothing found, nothing to say
    const list = fingerprints.map((f) => `\`${f.product} ${f.version}\` (${f.source})`).join(', ');
    out.push(makeWebFinding(ctx.origin, 'cve-lookup-not-performed', 'info', 'security',
      'Software versions fingerprinted — no advisory feed configured',
      `The scan identified ${fingerprints.length} disclosed component version(s): ${list}. **No CVE advisory lookup was performed** — this deployment has no advisory feed configured (${outcome.reason ?? 'no feed adapter is available'}), so this is NOT a statement that the versions are free of known vulnerabilities.`,
      'Configure an advisory feed (`CVE_ADVISORY_FEED_URL` + `CVE_ADVISORY_FEED_API_KEY`) so these versions are checked against published advisories on every scan, and in the meantime check each version against the vendor\'s security advisories by hand.'));
    return out;
  }

  for (const { fingerprint, advisories } of matchAdvisories(fingerprints, outcome.advisories)) {
    const ids = advisories.map((a) => a.id).join(', ');
    const details = advisories
      .map((a) => `- **${a.id}** (${a.severity}): ${a.summary}${a.references?.length ? ` — ${a.references[0]}` : ''}`)
      .join('\n');
    out.push(makeWebFinding(ctx.origin,
      `cve-${fingerprint.product}`,
      worstSeverity(advisories),
      'security',
      `${fingerprint.product} ${fingerprint.version} has ${advisories.length} known vulnerability advisory(ies)`,
      `The site discloses \`${fingerprint.product} ${fingerprint.version}\` (via ${fingerprint.source}: \`${fingerprint.evidence}\`), which the ${outcome.feedId} advisory feed reports as affected by ${ids}:\n\n${details}`,
      `Upgrade ${fingerprint.product} to a release outside the affected ranges (see the advisories above), or apply the vendor's backported patch. If the version string is inaccurate, suppress it as well — it is what let this match be made from outside.`));
  }

  return out;
}
