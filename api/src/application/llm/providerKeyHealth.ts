/**
 * The operator-facing health verdict for ONE configured BYO provider — the status the
 * Integrations card and its drawer paint, derived in exactly one place so the status
 * READ and the Test button cannot disagree about what "ready" means.
 *
 * Why reachability belongs in the verdict: a Kimi Code subscription resolves perfectly
 * and carries no alert, yet with no runtime of the tenant's own online the gateway never
 * dispatches it — every candidate whose vendor declares `requiresLocalEgress` is skipped
 * (see `hostEgress.ts`). The read used to answer `ready` off "the credential resolves"
 * while the Test button, one line below, answered `local_egress_required`. Same tenant,
 * same second, two verdicts. The credential is not the problem; reachability is, and
 * the card must say so BEFORE the operator spends a probe finding out.
 *
 * Precedence is deliberate and mirrors the drawer's own copy: configuration, then a
 * dispatch-observed rejection (health wins over storage), then resolvability, then
 * reachability. A rejection observed from a connected runtime is a real verdict on the
 * account and must not be masked by a later "no runtime" reading.
 */

import type { Env } from '../../env';
import { byoVendorIdFor, type LlmProvider, type ProviderAuthType } from './llmProviderCatalog';
import { onlineAgentHostId } from './hostEgress';
import type { ProviderAuthAlert } from './providerAuthAlerts';
import {
  providersFromCredentials,
  type ByoUnresolvedReason,
  type ProviderKeySummary,
  type TenantLlmCredentials,
} from './tenantProviderKeyService';
import { vendorRequiresLocalEgress } from './vendors/registry';
import type { VendorId } from './vendors/types';

/** Every status the read may answer. `local_egress_required` is the one that is NOT a
 *  verdict on the credential — nothing was presented to judge. */
export type ProviderKeyHealthStatus =
  | 'not_connected'
  | 'capacity'
  | 'needs_attention'
  | 'ready'
  | 'local_egress_required'
  | 'unavailable'
  | ByoUnresolvedReason;

/**
 * Whether this provider, connected THIS way, is reachable only from the tenant's own
 * runtime. Auth-type-aware because the subscription and api-key shapes of one provider
 * can dispatch to different vendor ids (`openai` → `openai-codex`), and only the vendor
 * module owns the declaration.
 */
export function providerRequiresLocalEgress(provider: LlmProvider, authType: ProviderAuthType): boolean {
  return vendorRequiresLocalEgress(byoVendorIdFor(provider, authType) as VendorId);
}

export interface ProviderKeyHealthFacts {
  /** A credential row exists for this provider. */
  configured: boolean;
  /** The stored credential resolved into something the gateway could present. */
  usable: boolean;
  /** Why it did not resolve, when `usable` is false and the resolver said. */
  unresolvedReason?: ByoUnresolvedReason;
  /** The dispatch-observed rejection, when one is outstanding. */
  authAlert: ProviderAuthAlert | null;
  /** The vendor this credential dispatches to refuses the hosted gateway's egress. */
  requiresLocalEgress: boolean;
  /** A runtime of the tenant's own is online to carry that egress. */
  localEgressOnline: boolean;
}

/** Pure verdict — the ONE ordering of the facts, testable without a database. */
export function deriveProviderKeyHealth(facts: ProviderKeyHealthFacts): ProviderKeyHealthStatus {
  if (!facts.configured) return 'not_connected';
  if (facts.authAlert?.reason === 'capacity') return 'capacity';
  if (facts.authAlert) return 'needs_attention';
  if (!facts.usable) return facts.unresolvedReason ?? 'unavailable';
  if (facts.requiresLocalEgress && !facts.localEgressOnline) return 'local_egress_required';
  return 'ready';
}

export interface ProviderKeyHealthInputs {
  details: ProviderKeySummary[];
  creds: TenantLlmCredentials;
  authAlert: ProviderAuthAlert | null;
}

/**
 * The verdict for one provider from already-loaded inputs. The online-host lookup —
 * a cached DB read — is made ONLY when the vendor actually needs local egress, so the
 * overwhelming majority of providers add no round-trip to the status read.
 */
export async function resolveProviderKeyHealth(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  { details, creds, authAlert }: ProviderKeyHealthInputs,
): Promise<{ status: ProviderKeyHealthStatus; configured: boolean; usable: boolean }> {
  const row = details.find((d) => d.provider === provider);
  const configured = row !== undefined;
  const usable = providersFromCredentials(creds).includes(provider);
  const requiresLocalEgress = row ? providerRequiresLocalEgress(provider, row.authType) : false;
  const localEgressOnline = requiresLocalEgress && configured && usable && !authAlert
    ? (await onlineAgentHostId(env, tenantId)) != null
    : false;
  const status = deriveProviderKeyHealth({
    configured,
    usable,
    ...(creds.unresolvedReasons[provider] ? { unresolvedReason: creds.unresolvedReasons[provider] } : {}),
    authAlert,
    requiresLocalEgress,
    localEgressOnline,
  });
  return { status, configured, usable };
}
