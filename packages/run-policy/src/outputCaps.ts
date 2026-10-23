/**
 * THE per-role reply cap (cost lever D5). Output tokens cost 4–5× input on most
 * frontier models, and a turn that names no `max_tokens` gets the vendor default
 * (16K on the direct Anthropic path). Roles that only read, decide or verify never
 * need that much; coding needs room for an edit, not for a rewrite.
 *
 * One table, read by every loop that builds a turn, so a role costs the same
 * ceiling on every host. Callers gate it behind `d5_output_caps` and keep an
 * explicit caller-supplied `max_tokens` when it is lower.
 */

export type OutputCapRole = 'explore' | 'utility' | 'verify' | 'chat' | 'plan' | 'code';

export const ROLE_OUTPUT_CAPS: Readonly<Record<OutputCapRole, number>> = {
  explore: 2_048,
  utility: 2_048,
  verify: 2_048,
  chat: 4_096,
  plan: 4_096,
  code: 8_192,
};

/** The cap for a role; `undefined` for a role this table does not know (caller keeps its default). */
export function roleOutputCap(role: string | null | undefined): number | undefined {
  return role && role in ROLE_OUTPUT_CAPS ? ROLE_OUTPUT_CAPS[role as OutputCapRole] : undefined;
}

/** The `max_tokens` to send: the lower of the caller's and the role cap; the role cap when the caller set none. */
export function cappedMaxTokens(role: string | null | undefined, callerMaxTokens: number | undefined): number | undefined {
  const cap = roleOutputCap(role);
  if (cap === undefined) return callerMaxTokens;
  return callerMaxTokens && callerMaxTokens > 0 ? Math.min(cap, callerMaxTokens) : cap;
}
