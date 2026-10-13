/**
 * The hosted-site A/B split, as pure functions (PRD 33 §5.1.4 "Test it").
 *
 * A running `ab_tests` row created by a prescription (`rx-<prescriptionId>`) splits
 * a hosted site's traffic between the LIVE release and a PREVIEW release. The sites
 * Worker assigns each visitor a sticky `bf_ab_<testId>` cookie by the variants'
 * allocation, serves that variant's release, and writes `data-variant="ab<testId>:<key>"`
 * on the injected loader tag so the recording — and the conversion ingest records
 * against the variant — know which arm the visitor saw.
 */

/** The `ab_tests.key` prefix of a prescription's test. */
export const PRESCRIPTION_TEST_KEY_PREFIX = 'rx-';

/** The variant keys a prescription test always has. */
export const LIVE_VARIANT_KEY = 'live';
export const PREVIEW_VARIANT_KEY = 'preview';

/** The sticky cookie's lifetime: long enough to outlast any test's window. */
export const AB_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SplitVariant {
  id: number;
  key: string;
  trafficPercent: number;
}

const VARIANT_KEY = /^[a-z0-9_-]{1,48}$/;

export const abCookieName = (testId: number): string => `bf_ab_${testId}`;

/** The `data-variant` label (and `replay_recordings.variant`). */
export const variantLabel = (testId: number, key: string): string => `ab${testId}:${key}`;

/** Parse a `data-variant` label back into its test and variant, or null when it is not ours. */
export function parseVariantLabel(label: string | null | undefined): { testId: number; key: string } | null {
  const match = /^ab(\d{1,10}):([a-z0-9_-]{1,48})$/.exec(label ?? '');
  if (!match) return null;
  return { testId: Number(match[1]), key: match[2]! };
}

/** One cookie's value from a `Cookie` header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Pick a variant by allocation. `roll` is uniform in [0, 100); variants are walked
 * in a stable order (by id) so the same roll always lands on the same arm.
 */
export function pickVariant<T extends SplitVariant>(variants: readonly T[], roll: number): T | null {
  const ordered = [...variants].filter((v) => v.trafficPercent > 0).sort((a, b) => a.id - b.id);
  if (ordered.length === 0) return null;
  let edge = 0;
  for (const variant of ordered) {
    edge += variant.trafficPercent;
    if (roll < edge) return variant;
  }
  return ordered[ordered.length - 1]!;
}

/**
 * The visitor's arm: the cookie's when it names a variant of this test, else a
 * fresh pick (`assigned: true` → set the cookie and count an exposure).
 */
export function assignVariant<T extends SplitVariant>(
  variants: readonly T[],
  cookieValue: string | null,
  roll: number,
): { variant: T; assigned: boolean } | null {
  if (cookieValue && VARIANT_KEY.test(cookieValue)) {
    const sticky = variants.find((v) => v.key === cookieValue);
    if (sticky) return { variant: sticky, assigned: false };
  }
  const picked = pickVariant(variants, roll);
  return picked ? { variant: picked, assigned: true } : null;
}

/** The `Set-Cookie` value for an assignment. */
export function abSetCookie(testId: number, key: string): string {
  return `${abCookieName(testId)}=${encodeURIComponent(key)}; Path=/; Max-Age=${AB_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure`;
}
