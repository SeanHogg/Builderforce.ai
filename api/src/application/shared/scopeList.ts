/**
 * A stored SCOPE LIST — the one implementation of "what may this credential do?".
 *
 * Three credentials on this platform answer that question: a tenant API key
 * (`bfk_*`), a developer/publisher API key (`bfai_*`), and an extension install's
 * grant. All three store the answer the same way — a JSON array in a `text`
 * column, with NULL or `[]` meaning UNRESTRICTED — and all three need the same
 * three operations: serialise on write, deserialise on read, and test one
 * required scope against what was stored.
 *
 * `tenantApiKeyService.ts` had the only copy, welded to `TENANT_API_SCOPES`.
 * Adding publisher keys and install grants would have made that three copies of
 * `JSON.parse` in a try/catch and three subtly different answers to "is an empty
 * list allowed or denied" — which is the DRY violation this module exists to
 * refuse. The VOCABULARY stays with each credential (a tenant key's scopes and an
 * extension's scopes are different words); the MECHANICS live here once.
 *
 * ── THE ONE RULE WORTH STATING TWICE ────────────────────────────────────────
 * NULL / empty means unrestricted, not denied. That is a deliberate legacy
 * accommodation: keys minted before migration 0070 carry no scopes and must keep
 * working. A new credential should always be minted WITH an explicit list, so
 * `requireScopes` is the shape a new caller reaches for — it refuses the empty
 * list rather than widening it.
 */

/** Parse a stored scope column. Malformed JSON reads as "no list", never throws. */
export function deserializeScopes(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Serialise a scope list for storage, keeping only members of `vocabulary`.
 *
 * Filtering here rather than at each call site is what stops an unknown scope
 * string from being stored and later read back as a grant nothing enforces.
 */
export function serializeScopes(
  scopes: readonly string[] | null | undefined,
  vocabulary: readonly string[],
): string | null {
  if (!scopes || scopes.length === 0) return null;
  const clean = scopes.filter((s) => vocabulary.includes(s));
  return clean.length ? JSON.stringify(clean) : null;
}

/**
 * Does a credential with these stored scopes satisfy `required`?
 *
 * NULL / empty → unrestricted → allowed. See the block comment.
 */
export function hasScope(scopes: readonly string[] | null, required: string): boolean {
  if (!scopes || scopes.length === 0) return true;
  return scopes.includes(required);
}

/**
 * The strict form: an empty grant grants NOTHING.
 *
 * Use wherever the credential is new enough that there are no legacy unrestricted
 * rows to accommodate — extension installs, most obviously, where "the admin
 * approved no scopes" must never read as "the admin approved everything".
 */
export function requireScope(scopes: readonly string[] | null, required: string): boolean {
  return Array.isArray(scopes) && scopes.includes(required);
}

/** Keep only the members of `vocabulary`, de-duplicated and in vocabulary order. */
export function normalizeScopes(
  scopes: readonly string[] | null | undefined,
  vocabulary: readonly string[],
): string[] {
  if (!scopes || scopes.length === 0) return [];
  const wanted = new Set(scopes);
  return vocabulary.filter((s) => wanted.has(s));
}

/**
 * Scopes in `next` that `previous` did not already carry.
 *
 * The install flow's whole security argument rests on this: a version bump that
 * widens scopes must re-prompt the admin, and one that does not may update
 * silently. Computing the difference in one place means the two callers (the
 * install preview and the auto-update decision) cannot disagree about it.
 */
export function widenedScopes(
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined,
): string[] {
  const had = new Set(previous ?? []);
  return (next ?? []).filter((s) => !had.has(s));
}
