/**
 * BYO credential HEALTH — the one probe that answers "is this connected account actually
 * working right now?", plus the record/clear of the operator-facing verdict.
 *
 * Why this exists as a primitive rather than inline route code: three surfaces have to
 * agree, and when they didn't, the Integrations page showed five green "connected" cards
 * next to a Test-connection button that failed.
 *
 *   Settings ▸ Integrations "Test connection"  ─┐
 *   Daily sweep (byoCredentialHealthCron)      ─┼─► probeByoProvider() ─► providerAuthAlerts
 *   (dispatch-observed failures)               ─┘                          │
 *                                                                         ├─► the card's
 *                                                                         │   health chip
 *                                                                         └─► the "your
 *                                                                             integration
 *                                                                             stopped
 *                                                                             working" mail
 *
 * The probe is deliberately the SAME dispatch path a real completion takes — a strict pin
 * on the model that provider's own account actually LEADS with, so a green verdict means
 * "the credential the cascade will use works", not "some catalog id resolved". Two
 * consequences worth stating:
 *
 *   • it costs the tenant a real (tiny) upstream call on their own account, which is why
 *     the sweep runs daily and not on the 5-minute tick;
 *   • it needs no `TenantAccess`, so the cron can call it. A strict BYO pin never consults
 *     the plan (see `pickCloudModel`: an own-account pin is honoured on any plan) and
 *     `disablePaidOverflow` + BYO-strict close every operator-funded path, so passing a
 *     fixed `free` plan cannot route the probe onto our money.
 */

import type { Env } from '../../env';
import { llmProxyForPlan, newTraceId, byoAutoSeedModels, type ChatCompletionRequest } from './LlmProxyService';
import { byoModelsFor } from './byoModelRouting';
import {
  byoVendorIdFor,
  providersFromCredentials,
  resolveTenantLlmCredentials,
  resolvedAuthTypeFor,
  type ByoUnresolvedReason,
  type LlmProvider,
  type TenantLlmCredentials,
} from './tenantProviderKeyService';
import {
  clearProviderAuthAlert,
  loadProviderAuthAlert,
  providerAlertFromFailure,
  recordProviderAuthAlert,
  type ProviderAuthAlert,
} from './providerAuthAlerts';
import { raiseProviderAuthAlert } from './byoCredentialAlerting';

/**
 * The probe's verdict for one tenant+provider.
 *
 * `ok` is the ONLY field a caller should branch on for "is this working". `alert` is
 * non-null exactly when the failure is one the OWNER can act on — a rejected credential,
 * an unentitled plan, an exhausted budget — and it is what got persisted. A failure with
 * `ok: false` and `alert: null` is a transient upstream blip (429 without a capacity
 * marker, 5xx, timeout): worth showing to someone who just clicked Test, never worth
 * emailing about or painting the card red over.
 */
export interface ByoProbeResult {
  provider: LlmProvider;
  ok: boolean;
  /** `ready` on success, else a short machine status the UI localizes:
   *  the unresolved reason, `not_connected`, `no_test_model`, or `failed`. */
  status: 'ready' | 'not_connected' | 'no_test_model' | 'failed' | ByoUnresolvedReason;
  /** The model the probe pinned (absent when it never got that far). */
  model?: string;
  /** Upstream HTTP status, when a request was actually made. */
  upstreamStatus?: number;
  /** Human-readable failure detail — the upstream's own message where available. */
  error?: string;
  /** The persisted owner-actionable alert, when the failure was one. */
  alert?: ProviderAuthAlert;
  checkedAt: string;
}

export interface ProbeOptions {
  /** Pre-resolved credential set, so a caller probing several providers for one tenant
   *  resolves it ONCE instead of per provider — the sweep does exactly that. */
  creds?: TenantLlmCredentials;
  /** Whether a newly-raised alert also NOTIFIES the workspace's admins (default `true`).
   *  The daily sweep passes `false` and sends one batched mail covering every provider it
   *  found broken, so a workspace whose whole account set lapsed overnight gets a single
   *  message instead of one per provider. The alert is still recorded either way. */
  notify?: boolean;
}

/** Cap on the upstream error text carried into a verdict / email. Enough to include a
 *  provider's own diagnostic, bounded so a raw HTML error page can't bloat a KV value. */
const MAX_ERROR_CHARS = 1000;

/**
 * 64 rather than a handful: the OpenAI Responses surface rejects a `max_output_tokens`
 * under 16, and a reasoning model spends its first tokens on reasoning, so too small a
 * budget fails a healthy credential.
 */
const PROBE_MAX_TOKENS = 64;

/** Pull the most useful message out of an upstream error body without trusting its shape. */
function upstreamMessage(payload: string): string {
  const bounded = payload.slice(0, MAX_ERROR_CHARS);
  try {
    const parsed = JSON.parse(payload) as { error?: { message?: string } | string; message?: string };
    const extracted = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message;
    return (extracted ?? bounded).slice(0, MAX_ERROR_CHARS);
  } catch {
    return bounded;
  }
}

/**
 * The model this account actually LEADS with — the same seed BYO flagship routing picks,
 * on the route its auth type dispatches through. Falls back to any catalog model served by
 * the provider's vendor so a provider with no designated flagship is still testable.
 */
export function probeModelFor(provider: LlmProvider, creds: TenantLlmCredentials): string | null {
  const authType = resolvedAuthTypeFor(provider, creds);
  return byoAutoSeedModels(new Set([byoVendorIdFor(provider, authType)]), { agentic: false })[0]
    ?? byoModelsFor([{ provider, authType, priority: null }])[0]?.id
    ?? null;
}

/**
 * Probe ONE connected provider on the tenant's own credential and persist the verdict.
 *
 * Side effects are the point — this is the write path for credential health:
 *   • an owner-actionable failure records a {@link ProviderAuthAlert} (so the Integrations
 *     card stops claiming the account is fine);
 *   • a success CLEARS any stale alert (an account fixed out of band goes green again
 *     without anyone having to dismiss anything).
 * A transient failure does neither: it leaves the prior verdict untouched rather than
 * flapping the UI (and the cron's email) on a rate limit.
 *
 * `creds` is accepted so a caller probing several providers for one tenant resolves the
 * credential set ONCE instead of per provider — the cron does exactly that.
 */
export async function probeByoProvider(
  env: Env,
  tenantId: number,
  provider: LlmProvider,
  opts: ProbeOptions = {},
): Promise<ByoProbeResult> {
  const notify = opts.notify ?? true;
  const raise = (alert: ProviderAuthAlert, detail: string) => notify
    ? raiseProviderAuthAlert(env, tenantId, alert, detail).then(() => undefined)
    : recordProviderAuthAlert(env, tenantId, alert);
  const resolved = opts.creds ?? await resolveTenantLlmCredentials(env, tenantId);
  const checkedAt = new Date().toISOString();
  const now = Date.parse(checkedAt);

  // Configured but not resolvable (revoked / expired / undecryptable / stored under
  // another workspace): nothing to send upstream, and it is 100% owner-actionable, so it
  // records an alert of its own rather than being reported as a bare "could not run".
  // This is the case `configured`/`usable` already knew about but nothing ever ESCALATED.
  if (!providersFromCredentials(resolved).includes(provider)) {
    const reason = resolved.unresolvedReasons[provider];
    if (!reason) {
      // Not connected at all — no credential to judge, so no alert either way.
      return { provider, ok: false, status: 'not_connected', checkedAt };
    }
    // Base vendor id, not the auth-type-aware one: the credential did not resolve, so the
    // resolved auth type is unknowable here. `unresolved` remediation is the same for both
    // shapes ("reconnect this provider"), and the base id still maps back through
    // `providerForVendor`, which is all any consumer reads it for.
    const alert: ProviderAuthAlert = { provider, reason: 'unresolved', status: 0, vendor: byoVendorIdFor(provider, 'api_key'), at: now };
    const detail = `Stored credential could not be used (${reason}).`;
    await raise(alert, detail);
    return { provider, ok: false, status: reason, error: detail, alert, checkedAt };
  }

  const model = probeModelFor(provider, resolved);
  if (!model) return { provider, ok: false, status: 'no_test_model', checkedAt };

  const body: ChatCompletionRequest = {
    model, modelStrict: true, max_tokens: PROBE_MAX_TOKENS,
    messages: [{ role: 'user', content: 'Reply OK.' }],
  };
  const service = llmProxyForPlan(env, 'free', false, {
    disablePaidOverflow: true,
    anthropicOAuthToken: resolved.anthropicOAuthToken,
    openaiCodexAuth: resolved.openaiCodexAuth,
    xaiOAuthToken: resolved.xaiOAuthToken,
    tenantVendorKeys: resolved.vendorKeys,
    byoVendorPriority: resolved.vendorPriority,
  });
  const result = await service.complete(body, undefined, newTraceId());

  if (result.response.status < 400) {
    await clearProviderAuthAlert(env, tenantId, provider);
    return { provider, ok: true, status: 'ready', model: result.resolvedModel, upstreamStatus: result.response.status, checkedAt };
  }

  const payload = await result.response.clone().text();
  const message = upstreamMessage(payload);
  // A 400/422 carries the upstream's own diagnostic verbatim, but a retryable failure
  // (401/403/429/5xx) collapses into the gateway's cascade summary — which reads as a bare
  // "failed" to the operator. Append the per-attempt upstream status so the reason is
  // actionable, and use those attempts for classification: the top-level status is the
  // gateway's rolled-up envelope, while the ATTEMPT carries the real 401/403/capacity.
  const attemptDetail = result.failovers?.map((f) => `${f.vendor}/${f.model} → HTTP ${f.code}`).join('; ');
  const error = [
    message || `upstream HTTP ${result.response.status}`,
    attemptDetail ? `(${attemptDetail})` : '',
  ].filter(Boolean).join(' ');

  const alert = (result.failovers ?? []).reduce<ProviderAuthAlert | null>(
    (found, f) => found ?? providerAlertFromFailure(f.vendor, f.code, f.detail ?? message, now),
    null,
  ) ?? providerAlertFromFailure(result.resolvedVendor, result.response.status, message, now);

  // Raise (not just record): a probe is often the FIRST observation of a breakage, and
  // the owner should hear about it the moment anything notices — the Test button included.
  if (alert) await raise(alert, error);
  return {
    provider, ok: false, status: 'failed', model,
    upstreamStatus: result.response.status, error,
    ...(alert ? { alert } : {}),
    checkedAt,
  };
}

/**
 * Probe every provider a tenant has CONNECTED, resolving their credentials once.
 *
 * Returns the prior alert alongside each verdict so a caller can act on the TRANSITION
 * rather than the state — that is what keeps the daily sweep email-quiet for an account
 * that has been broken (and already reported) for a week. Sequential on purpose: ≤8
 * providers, each a real upstream call on the owner's account, and a burst of parallel
 * probes against one account is a good way to earn a rate limit that then looks like a
 * credential failure.
 */
export async function probeTenantByoProviders(
  env: Env,
  tenantId: number,
  opts: Pick<ProbeOptions, 'notify'> = {},
): Promise<Array<{ result: ByoProbeResult; previousAlert: ProviderAuthAlert | null }>> {
  const creds = await resolveTenantLlmCredentials(env, tenantId);
  const out: Array<{ result: ByoProbeResult; previousAlert: ProviderAuthAlert | null }> = [];
  for (const provider of creds.configuredProviders) {
    const previousAlert = await loadProviderAuthAlert(env, tenantId, provider).catch(() => null);
    const result = await probeByoProvider(env, tenantId, provider, { creds, ...opts }).catch((err): ByoProbeResult => ({
      provider, ok: false, status: 'failed',
      error: err instanceof Error ? err.message : 'probe failed',
      checkedAt: new Date().toISOString(),
    }));
    out.push({ result, previousAlert });
  }
  return out;
}
