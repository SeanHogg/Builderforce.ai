/**
 * LOCAL CREDENTIAL — a connected subscription's short-lived access token, issued to a
 * runtime on the member's OWN machine (the VS Code extension, Rovr) so it can call the
 * provider directly.
 *
 * Why this exists: some providers refuse our cloud, not our credentials. Kimi's edge
 * answers the Workers ASN with an HTML 403 before it reads a key (`hostEgress.ts`), so a
 * Kimi subscription connected to Builderforce could be USED only when a separate agent
 * runtime happened to be online to relay through. The editor and the browser the member
 * is sitting at are exactly the personal interactive client the subscription is licensed
 * for, and they can make the call themselves — they only lacked the token.
 *
 * Why the gateway keeps OWNING the grant: Kimi rotates its refresh token on every grant,
 * so a second refresher of the same grant always ends up holding a retired token. The
 * server therefore stays the single refresher (`resolveKimiOAuthResolution`) and this
 * module hands out the ACCESS token only — never the refresh token. A leaked local cache
 * entry is worth at most one access-token lifetime (fifteen minutes for Kimi).
 *
 * Sources are DATA ({@link LOCAL_CREDENTIAL_SOURCES}): another local-egress subscription
 * joins with an entry, not a branch.
 *
 * Not read-through cached, deliberately: the answer IS a secret with a fifteen-minute
 * life, and the reads beneath it (the provider row, the model selection) are already
 * served through `getOrSetCached` by their own modules.
 */
import type { Env } from '../../env';
import type { LlmProvider } from './llmProviderCatalog';
import { listProviderModelSelections } from './providerModelSelection';
import {
  listTenantProviderKeys,
  resolveKimiOAuthResolution,
  type ByoUnresolvedReason,
} from './tenantProviderKeyService';
import { getModule, type VendorId } from './vendors';
import { KIMI_CODE_API_BASE_URL } from './vendors/openaiCompatibleVendors';

/** How one provider's subscription is issued to a local runtime. */
interface LocalCredentialSource {
  /** The client-side local runtime that dispatches it (`@builderforce/local-inference`). */
  runtime: 'kimi-code';
  /** The gateway vendor whose catalog lists the models. */
  vendor: VendorId;
  /** OpenAI-compatible base the runtime calls. */
  baseUrl: string;
  /** The provider's own names and windows for its models. Unknown ids show bare. */
  models: Readonly<Record<string, { displayName: string; contextWindow?: number }>>;
  /** A fresh access token, rotating the stored grant when it is due. */
  resolve(env: Env, tenantId: number): Promise<{ token: string | null; reason?: ByoUnresolvedReason; expires?: number }>;
}

const LOCAL_CREDENTIAL_SOURCES: Partial<Record<LlmProvider, LocalCredentialSource>> = {
  kimi: {
    runtime: 'kimi-code',
    vendor: 'kimi-code',
    baseUrl: KIMI_CODE_API_BASE_URL,
    // Kimi's documented membership models (kimi.com/code/docs/en/kimi-code/models).
    models: {
      k3: { displayName: 'Kimi K3', contextWindow: 1_048_576 },
      'k3-256k': { displayName: 'Kimi K3 (256K)', contextWindow: 262_144 },
      'kimi-for-coding': { displayName: 'Kimi K2.8 Coding', contextWindow: 1_048_576 },
      'kimi-for-coding-highspeed': { displayName: 'Kimi K2.7 Code HighSpeed', contextWindow: 262_144 },
    },
    resolve: resolveKimiOAuthResolution,
  },
};

/** Whether a provider's subscription can be issued to a local runtime at all. */
export function supportsLocalCredential(provider: LlmProvider): boolean {
  return LOCAL_CREDENTIAL_SOURCES[provider] !== undefined;
}

export interface LocalCredentialModel {
  model: string;
  displayName: string;
  contextWindow?: number;
}

export interface LocalCredentialBody {
  provider: LlmProvider;
  runtime: string;
  accessToken: string;
  /** Absolute expiry, epoch milliseconds. */
  expiresAt: number;
  baseUrl: string;
  /** The tenant's chosen order when they made one, else the vendor catalog's. */
  models: LocalCredentialModel[];
}

export type LocalCredentialResult =
  | { kind: 'credential'; body: LocalCredentialBody }
  | { kind: 'unsupported' }
  | { kind: 'not_connected' }
  /** A connection exists but cannot be issued — the client should connect again. */
  | { kind: 'reconnect'; reason: ByoUnresolvedReason | 'api_key_connection' };

/**
 * Issue the local credential for one provider on one tenant.
 *
 * `not_connected` and `reconnect` are what drive a client's "connect your account" step:
 * the first when nothing was ever connected, the second when the stored grant is dead —
 * or is an API-key connection, which is never shipped to a device (a long-lived key is a
 * different risk from a fifteen-minute token; connecting the subscription replaces it).
 */
export async function issueLocalCredential(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  nowMs: number = Date.now(),
): Promise<LocalCredentialResult> {
  const source = LOCAL_CREDENTIAL_SOURCES[provider];
  if (!source) return { kind: 'unsupported' };

  const connection = (await listTenantProviderKeys(env, tenantId)).find((row) => row.provider === provider);
  if (!connection) return { kind: 'not_connected' };
  if (connection.authType !== 'oauth') return { kind: 'reconnect', reason: 'api_key_connection' };

  const [resolution, selections] = await Promise.all([
    source.resolve(env, tenantId),
    listProviderModelSelections(env, tenantId).catch(() => ({})),
  ]);
  if (!resolution.token) return { kind: 'reconnect', reason: resolution.reason ?? 'revoked' };

  const selected = (selections as Partial<Record<LlmProvider, string[]>>)[provider];
  const ids = selected?.length ? selected : getModule(source.vendor).catalog.map((entry) => entry.id);
  return {
    kind: 'credential',
    body: {
      provider,
      runtime: source.runtime,
      accessToken: resolution.token,
      expiresAt: resolution.expires ?? nowMs,
      baseUrl: source.baseUrl,
      models: ids.map((model) => ({ model, displayName: model, ...source.models[model] })),
    },
  };
}
