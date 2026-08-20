/**
 * Fail-closed BYO policy for CLOUD AGENT EXECUTIONS (GAP-B2 / GAP-B4).
 *
 * ── THE LEAK THIS CLOSES ─────────────────────────────────────────────────────
 * A cloud agent run is supposed to execute on the TENANT's own provider account.
 * Both paths it can take used to degrade silently onto the platform-funded pool
 * when that account could not be used:
 *
 *   • The V2 gateway path (`ANTHROPIC_BASE_URL = <api>/llm`, `POST /llm/v1/messages`):
 *     with no resolvable tenant Anthropic credential the route falls through to the
 *     Messages⇄OpenAI translation and serves the turn from OUR pool — correct for an
 *     ordinary gateway chat, a billing leak for a cloud-agent execution.
 *   • The cloud tool loop: a tenant with a CONNECTED-but-unusable credential (rotated
 *     encryption key, revoked subscription) reached the proxy's generic
 *     `byo_unavailable` only after composing a chain — an unclear failure mode with
 *     no named cause (GAP-B4).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * Scoped deliberately: it applies to the CLOUD-AGENT EXECUTION path only. Ordinary
 * gateway traffic (web chat, the VSIX, an on-prem host) may legitimately run on the
 * platform pool and is untouched — {@link isCloudAgentExecutionRequest} is the ONE
 * place that decides which is which.
 *
 * Two typed outcomes, never a raw provider error:
 *   • `byo_key_missing` — BYO is required for this run and NO credential is connected.
 *   • `byo_key_error`   — a credential IS connected but could not be used this call
 *                         (undecryptable / revoked / expired / lookup failed).
 *
 * Everything here is pure except the two thin resolvers at the bottom, so the policy
 * is unit-testable without a database.
 */
import type { HonoEnv } from '../../env';
import {
  resolveAnthropicResolution,
  unresolvedProviders,
  type AnthropicAuth,
  type AnthropicResolution,
  type ByoUnresolvedReason,
  type LlmProvider,
  type TenantLlmCredentials,
} from './tenantProviderKeyService';

type Env = HonoEnv['Bindings'];

/** The typed failure codes a fail-closed cloud run surfaces instead of a provider error. */
export type CloudByoFailureCode = 'byo_key_missing' | 'byo_key_error';

export interface CloudByoFailure {
  ok: false;
  code: CloudByoFailureCode;
  /** The provider the run needed (today always the cloud engine's Anthropic route). */
  provider: LlmProvider;
  /** WHY a connected credential was unusable. Absent for `byo_key_missing`. */
  reason?: ByoUnresolvedReason;
  /** Operator-facing sentence — safe to put on an execution row or an HTTP body. */
  message: string;
}

export interface CloudByoAllowed {
  ok: true;
  auth: AnthropicAuth;
}

/** The header a runner stamps to declare "this request IS a cloud agent execution". */
export const CLOUD_SURFACE_HEADER = 'x-builderforce-surface';
/** The header carrying the execution id, so a fail-closed refusal is attributable. */
export const CLOUD_EXECUTION_HEADER = 'x-builderforce-execution-id';
/** The `x-builderforce-surface` value that marks cloud-agent execution traffic. */
export const CLOUD_SURFACE_VALUE = 'cloud';

/**
 * Is this gateway request a cloud-agent EXECUTION (as opposed to ordinary gateway
 * traffic)? The single discriminator for the fail-closed rule: a runner declares
 * itself with `x-builderforce-surface: cloud`, and an execution id makes the
 * refusal attributable to a run. Both are required — a surface hint alone is only
 * an attribution label (see `resolveUsageSurface`) and must not change billing
 * policy on its own.
 */
export function isCloudAgentExecutionRequest(header: (name: string) => string | undefined | null): boolean {
  const surface = (header(CLOUD_SURFACE_HEADER) ?? '').trim().toLowerCase();
  if (surface !== CLOUD_SURFACE_VALUE) return false;
  const executionId = Number((header(CLOUD_EXECUTION_HEADER) ?? '').trim());
  return Number.isFinite(executionId) && executionId > 0;
}

/** The execution id a cloud-agent request declared, or null. */
export function cloudExecutionIdFromRequest(header: (name: string) => string | undefined | null): number | null {
  const executionId = Number((header(CLOUD_EXECUTION_HEADER) ?? '').trim());
  return Number.isFinite(executionId) && executionId > 0 ? executionId : null;
}

/**
 * Classify a resolved Anthropic credential for a cloud-agent execution. PURE.
 *
 * `auth` present → the tenant's own key/subscription serves the run.
 * `auth` null + a reason → a credential exists but is unusable → `byo_key_error`.
 * `auth` null + no reason → nothing is connected → `byo_key_missing`.
 *
 * Either way the caller must NOT fall through to the platform pool.
 */
export function classifyCloudByoAnthropic(resolution: AnthropicResolution): CloudByoAllowed | CloudByoFailure {
  if (resolution.auth) return { ok: true, auth: resolution.auth };
  if (resolution.reason) {
    return {
      ok: false,
      code: 'byo_key_error',
      provider: 'anthropic',
      reason: resolution.reason,
      message: `This cloud agent run must execute on the workspace's own Anthropic credential, but the connected credential could not be used (${resolution.reason}). Reconnect or re-enter the key — the run was stopped rather than billed to the platform account.`,
    };
  }
  return {
    ok: false,
    code: 'byo_key_missing',
    provider: 'anthropic',
    message: "This cloud agent run must execute on the workspace's own Anthropic credential, but no Anthropic provider is connected on this workspace. Connect one — the run was stopped rather than billed to the platform account.",
  };
}

/**
 * The loop's pre-flight: given the credentials a cloud run resolved, is it safe to
 * dispatch? Returns null when it is.
 *
 * A tenant with NOTHING connected keeps today's behaviour (cloud runs are a funded
 * platform surface — see `recordCloudUsage`); a tenant who DID connect providers has
 * declared "run on my account", so a run where none of them resolved fails closed
 * with the named reason instead of quietly spending from the operator pool.
 */
export function assertCloudRunByo(creds: TenantLlmCredentials): CloudByoFailure | null {
  if (creds.configuredProviders.length === 0) return null;
  const unresolved = unresolvedProviders(creds);
  // At least one connected provider resolved → the run rides the tenant's account.
  if (unresolved.length < creds.configuredProviders.length) return null;
  const provider = unresolved[0] ?? creds.configuredProviders[0]!;
  const detail = unresolved
    .map((p) => `${p} (${creds.unresolvedReasons[p] ?? 'undecryptable'})`)
    .join(', ');
  return {
    ok: false,
    code: 'byo_key_error',
    provider,
    ...(creds.unresolvedReasons[provider] ? { reason: creds.unresolvedReasons[provider] } : {}),
    message: `This cloud agent run must execute on the workspace's own provider account, but none of the connected providers resolved to a usable credential: ${detail}. Reconnect or re-enter the credential — the run was stopped rather than billed to the platform account.`,
  };
}

/** The JSON body a fail-closed gateway refusal returns. One encoder, so the route,
 *  the runner and the tests agree on the shape. */
export function cloudByoFailureBody(failure: CloudByoFailure): {
  error: string;
  code: CloudByoFailureCode;
  provider: LlmProvider;
  reason?: ByoUnresolvedReason;
} {
  return {
    error: failure.message,
    code: failure.code,
    provider: failure.provider,
    ...(failure.reason ? { reason: failure.reason } : {}),
  };
}

/**
 * HTTP status for a fail-closed refusal: `402 Payment Required` — the request was
 * authenticated and well-formed, and was refused because it would have been billed
 * to the wrong account. Distinct from 401/403 (auth) and 503 (`byo_unavailable`,
 * "we tried and nothing was reachable").
 */
export const CLOUD_BYO_FAILURE_STATUS = 402;

/**
 * Resolve the tenant's Anthropic credential for a cloud-agent execution, fail-closed.
 * The one entry point the gateway route calls.
 */
export async function requireCloudByoAnthropic(env: Env, tenantId: number): Promise<CloudByoAllowed | CloudByoFailure> {
  return classifyCloudByoAnthropic(await resolveAnthropicResolution(env, tenantId));
}
