/**
 * integrationCredentialSecret — THE one resolver for the secret that seals and
 * unseals `integration_credentials.credentials_enc`.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ─────────────────────────────────────────────
 * There are TWO at-rest credential secrets in this codebase and they are not
 * interchangeable. Which one applies is decided by WHICH TABLE holds the ciphertext,
 * never by which module is asking:
 *
 *   • THIS one — `INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET` — seals
 *     `integration_credentials`. Everything that reads a tenant's connected-system
 *     token goes through it: git provider tokens (via `resolveRepoCredential`), board
 *     sync, CI/webhook handlers, quality + QA ingest, revenue intel, RFP and investor
 *     routes. A git token is not a special case — it is an integration credential that
 *     happens to be used for git.
 *
 *   • {@link ../integrations/credentialCrypto.credentialSecret} — the LONGER chain
 *     `CREDENTIAL_ENCRYPTION_SECRET ?? INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET` —
 *     seals the SENSITIVE stores: `connector_connections`, `tenant_llm_provider_keys`,
 *     MFA secrets, SSO client secrets, sealed artifacts. Those were deliberately split
 *     off JWT_SECRET (finding M2) so leaking the session-signing key stops decrypting
 *     them.
 *
 * The two chains diverge the moment an operator sets `CREDENTIAL_ENCRYPTION_SECRET`.
 * Using the wrong one against a given table does not fail loudly — it derives a
 * different PBKDF2 key and the row simply will not open. So the rule is: match the
 * TABLE, and never "simplify" one call onto the other.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────
 * This expression was hand-written inline at 46 sites across routes, sweeps, DOs and
 * services, plus THREE private helper copies under two different names — one of them
 * (`publishTaskVerdict`'s) named `credentialSecret`, colliding with the exported
 * three-level resolver of that exact name. Two functions, same name, different keys,
 * one import away from silently opening repo credentials with the wrong secret. The
 * copies are gone; the distinction now lives in this comment instead of in 46 places
 * where nobody could see it.
 *
 * ── THE PARAMETER TYPE IS DELIBERATELY STRUCTURAL ────────────────────────────────
 * Callers hold the secret-bearing env in several shapes: the full `Env` (where
 * `JWT_SECRET` is required), a narrowed `{ INTEGRATION_ENCRYPTION_SECRET?; JWT_SECRET? }`
 * cast used by routes and DOs, and `c.env` / `this.env`. Accepting the widest shape and
 * ending in `?? ''` reproduces EVERY previous site byte-for-byte: the sites that had a
 * `?? ''` tail keep it, and the sites that did not can never reach it because their
 * `JWT_SECRET` is non-optional. This migration changes no resolved value anywhere.
 */

/** The env fields this resolver reads. Structural so every caller shape satisfies it. */
export interface IntegrationSecretEnv {
  INTEGRATION_ENCRYPTION_SECRET?: string | undefined;
  JWT_SECRET?: string | undefined;
}

/** Resolve the secret that seals `integration_credentials`. */
export function integrationCredentialSecret(env: IntegrationSecretEnv): string {
  return env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
}
