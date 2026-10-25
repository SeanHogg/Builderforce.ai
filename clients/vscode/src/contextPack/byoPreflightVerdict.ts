/**
 * The model-preflight DECISION (PRD 35 E7), pure: which connected BYO accounts cannot
 * serve this run, spelled the way the gateway's `x-builderforce-byo-unresolved` header
 * spells them (`provider:reason`) so the run's banner and diagnostics read one format.
 *
 * Input is the server's own health verdict per provider (`GET /llm/provider-keys/:p/status`
 * → `providerKeyHealth.ts`). Only a verdict that means "the credential does not resolve"
 * counts — `capacity`, `needs_attention`, `local_egress_required` are not a missing
 * account, and `lookup_failed` is our own transient read failure, not the tenant's.
 */

/** The `ByoUnresolvedReason`s a run can be told about (api `tenantProviderKeyService.ts`). */
const UNRESOLVED: ReadonlySet<string> = new Set(["revoked", "expired", "undecryptable", "unsupported-auth", "other-workspace"]);

export interface ProviderHealth {
  provider: string;
  status: string;
}

/** `provider:reason` for each provider whose credential does not resolve, in input order. */
export function unresolvedByoEntries(health: readonly ProviderHealth[]): string[] {
  const out: string[] = [];
  for (const h of health) {
    if (!h.provider || !UNRESOLVED.has(h.status)) continue;
    const entry = `${h.provider}:${h.status}`;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * Where the run lands instead, when that is knowable from the same reads: the first
 * connected account (in the server's own listing order) whose credential is `ready`.
 * Undefined when none is — the gateway's platform models then answer, and which one is
 * routing's call, not something the editor can name in advance.
 */
export function preflightFallback(health: readonly ProviderHealth[]): string | undefined {
  const ready = health.find((h) => h.provider && h.status === "ready");
  return ready ? `your connected ${ready.provider} account` : undefined;
}
