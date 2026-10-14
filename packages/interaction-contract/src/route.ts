/**
 * Route templates and issue fingerprints (PRD 33 §3.4).
 *
 * Rollups are keyed by ROUTE, never by raw path, so `/orders/1234` and
 * `/orders/5678` are one row. The recorder templates in the browser and
 * ingest trusts the template; both call this one function.
 *
 * `issueFingerprint` names an issue identically in the browser and the
 * Worker: synchronous FNV-1a 64 over UTF-8, no WebCrypto, no platform branch.
 */

const MAX_ROUTE = 400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;
const HEX = /^[0-9a-f]{8,}$/i;
const LONG_TOKEN = /^[A-Za-z0-9_~.-]{20,}$/;
/** A long token has a digit or a capital — a lowercase-hyphen slug of 20+ chars stays a word. */
const TOKEN_SIGNAL = /[0-9A-Z]/;

function isIdSegment(segment: string): boolean {
  return (
    DIGITS.test(segment) ||
    UUID.test(segment) ||
    HEX.test(segment) ||
    (LONG_TOKEN.test(segment) && TOKEN_SIGNAL.test(segment))
  );
}

function pathOnly(path: string): string {
  let p = path.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(p);
  if (scheme) p = p.slice(scheme[0].length);
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function matchesTemplate(segments: readonly string[], template: string): boolean {
  const parts = pathOnly(template).split('/');
  if (parts.length !== segments.length) return false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.startsWith(':') || part === '*') continue;
    if (part !== segments[i]) return false;
  }
  return true;
}

/**
 * The route template of a path: query and hash stripped, segments that are
 * all digits, a UUID, ≥8 hex characters or a ≥20-character token replaced by
 * `:id`. A learned template (e.g. `/blog/:slug`) that matches the path wins.
 */
export function routeTemplate(path: string, learned?: readonly string[]): string {
  const p = pathOnly(path);
  const segments = p.split('/');
  if (learned) {
    for (const template of learned) {
      if (matchesTemplate(segments, template)) return pathOnly(template).slice(0, MAX_ROUTE);
    }
  }
  const templated = segments.map((segment) => (segment && isIdSegment(segment) ? ':id' : segment)).join('/');
  return (templated || '/').slice(0, MAX_ROUTE);
}

/**
 * FNV-1a 64-bit over the UTF-8 bytes of `text`, as 16 lowercase hex chars.
 *
 * Computed in four 16-bit limbs (no BigInt) so it compiles for the ES2017
 * frontend target and runs in any browser. The 64-bit prime is
 * 2^40 + 0x1b3: multiply every limb by 0x1b3, add the value shifted left
 * 40 bits (limbs 0,1 shifted 8 into limbs 2,3), then carry.
 */
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i++) {
    h0 ^= bytes[i]!;
    const t0 = h0 * 0x1b3;
    let t1 = h1 * 0x1b3;
    let t2 = h2 * 0x1b3 + (h0 << 8);
    const t3 = h3 * 0x1b3 + (h1 << 8);
    t1 += t0 >>> 16;
    h0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    h1 = t1 & 0xffff;
    h3 = (t3 + (t2 >>> 16)) & 0xffff;
    h2 = t2 & 0xffff;
  }
  return [h3, h2, h1, h0].map((limb) => limb.toString(16).padStart(4, '0')).join('');
}

export interface IssueFingerprintInput {
  siteId: string;
  route: string;
  kind: string;
  subject: string;
}

/** Deterministic issue id: the same input gives the same 16-hex string in every runtime. */
export function issueFingerprint({ siteId, route, kind, subject }: IssueFingerprintInput): string {
  return fnv1a64([siteId, route, kind, subject].join('\u001f'));
}
