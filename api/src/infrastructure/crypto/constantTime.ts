/**
 * CONSTANT-TIME COMPARISON — the one string equality an attacker can measure.
 *
 * `a === b` returns as soon as two characters differ, so the time it takes leaks
 * how long a prefix was correct. That is only exploitable where the attacker
 * controls the candidate and can retry without limit — which is precisely the
 * shape of every secret this codebase compares: a webhook signature, and an LRS
 * Basic credential pasted into somebody else's authoring tool.
 *
 * Lifted out of `application/backend/webhookVerification` when the second such
 * caller arrived. It lives here rather than beside a verifier because it is not
 * about webhooks — it is the same primitive `digest.ts` is, and a secret compare
 * reached for from a learning module has no business importing a module named for
 * webhooks to get it.
 *
 * NOT a substitute for hashing. This compares two values already in memory; it
 * says nothing about how the stored one was protected at rest.
 */

/** Length-checked, byte-folding comparison. No early return on a mismatch.
 *
 *  The length check DOES leak length, and that is deliberate and safe: the length
 *  of a fixed-format credential is public, and folding over the longer of two
 *  different lengths would compare a secret against out-of-range reads. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
