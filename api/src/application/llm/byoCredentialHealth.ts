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
import {
  llmProxyForPlan,
  newTraceId,
  byoAutoSeedModels,
  type ChatCompletionRequest,
  type LlmProxyService,
} from './LlmProxyService';
import { byoModelsFor } from './byoModelRouting';
import { buildHostEgress } from './hostEgress';
import { CASCADE_STATUSES, type UpstreamDiagnostic } from './vendors/types';
import {
  connectionModelRef,
  listOpenRouterConnections,
  resolveOpenRouterConnectionKeys,
} from './openRouterConnectionService';
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
  clearConnectionAuthAlert,
  clearProviderAuthAlert,
  connectionAlertFromFailure,
  loadConnectionAuthAlert,
  loadProviderAuthAlert,
  providerAlertFromFailure,
  recordConnectionAuthAlert,
  recordProviderAuthAlert,
  type ConnectionAuthAlert,
  type ProviderAuthAlert,
} from './providerAuthAlerts';
import { raiseConnectionAuthAlert, raiseProviderAuthAlert } from './byoCredentialAlerting';

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
/**
 * The redacted, copy-pasteable evidence for ONE failed probe.
 *
 * Exists because "test it and tell me what happened" and "give me something I can send
 * the provider" are different asks, and the second one was unanswerable: the operator
 * saw prose, while the endpoint, the provider's own request id, and whether an EDGE
 * refused the call before the key was read were all discarded inside the cascade. That
 * gap is what stalled the Kimi Code hosted-integration submission, whose checklist asks
 * for exactly these fields (`docs/partnerships/kimi-code-hosted-integration-request.md`).
 *
 * Everything here is safe to paste into a partner ticket: no credential, no prompt, no
 * request body — see {@link UpstreamDiagnostic} for the header allowlist.
 */
export interface ProbeDiagnostic extends UpstreamDiagnostic {
  /** The gateway trace id for this probe, so an operator's ticket and our own logs
   *  name the same request. */
  traceId: string;
  /** The model id the probe pinned. */
  model: string;
}

export interface ByoProbeResult {
  provider: LlmProvider;
  ok: boolean;
  /** `ready` on success, else a short machine status the UI localizes: the unresolved
   *  reason, `not_connected`, `no_test_model`, `upstream_error` (the credential was
   *  accepted and the model provider broke — NOT the owner's problem to fix), or `failed`. */
  status: 'ready' | 'not_connected' | 'no_test_model' | 'upstream_error' | 'failed' | ByoUnresolvedReason;
  /** The model the probe pinned (absent when it never got that far). */
  model?: string;
  /** Upstream HTTP status, when a request was actually made. */
  upstreamStatus?: number;
  /** Human-readable failure detail — the upstream's own message where available. */
  error?: string;
  /** The persisted owner-actionable alert, when the failure was one. */
  alert?: ProviderAuthAlert;
  /** Redacted upstream evidence for a failed probe — see {@link ProbeDiagnostic}. */
  diagnostic?: ProbeDiagnostic;
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
 * ONE probe dispatch, classified — the shared core behind every "is this actually working?"
 * button and sweep.
 *
 * It exists so the PROVIDER probe ({@link probeByoProvider}) and the OpenRouter CONNECTION
 * probe ({@link probeOpenRouterConnection}) cannot drift: the request shape (a strict pin, so
 * the verdict is about the credential under test and not about whatever the cascade would
 * have fallen back to), the way an upstream failure is turned into readable text, and the
 * classification into an owner-actionable alert are defined exactly once. When those lived in
 * one probe only, the second surface reported a bare "failed" for a failure the first would
 * have explained.
 */
interface ProbeDispatch<A> {
  ok: boolean;
  /** The id the gateway actually dispatched (a strict pin, so normally the requested one). */
  resolvedModel: string;
  /** The status the UPSTREAM returned, not the gateway's rolled-up envelope — the 502 the
   *  model provider sent, rather than the 429/503 the cascade wrapper reports. */
  upstreamStatus: number;
  /** Human-readable failure detail — absent on success. */
  error?: string;
  /** Redacted upstream evidence, when the attempt actually reached a response. */
  diagnostic?: ProbeDiagnostic;
  /** True when the failure is the transient class (429 without a capacity marker, 5xx,
   *  timeout): the credential was ACCEPTED and something downstream of it broke. The
   *  distinction IS the verdict — "your key is dead" and "the model provider had a bad
   *  minute" demand opposite reactions, and collapsing them into "failed" is how a working
   *  connection gets reported as broken. */
  retryable: boolean;
  /** The owner-actionable alert this failure classifies to, when it is one. `undefined` for
   *  a transient blip, which must never paint a card red or mail anyone. */
  alert?: A;
}

/** How a caller turns one failed attempt into its own alert shape — a provider alert or a
 *  connection alert. Passed in (rather than hard-coded) because the ATTEMPT-walking rule
 *  below is the part worth sharing; whose account it belongs to is the caller's business. */
type ProbeClassifier<A> = (vendor: string, status: number, detail: string) => A | null;

/**
 * One extra attempt for a TRANSIENT failure, and only for a transient one.
 *
 * A strict pin makes a single attempt by design — that is what keeps the verdict about the
 * credential under test rather than about whatever the cascade fell back to. The cost is that
 * one flaky upstream response becomes a red card for a connection that works: observed live,
 * where a `moonshotai/kimi-k3` probe rode the tenant's own key, reached OpenRouter, was
 * billed, and came back 502 from the model provider.
 *
 * Exactly one retry, and never on a rejected credential: re-sending a 401/403 cannot change
 * the answer and would spend the owner's money twice to learn nothing.
 */
const PROBE_RETRY_DELAY_MS = 300;

async function dispatchProbe<A>(
  service: LlmProxyService,
  model: string,
  classify: ProbeClassifier<A>,
): Promise<ProbeDispatch<A>> {
  const first = await attemptProbe(service, model, classify);
  if (first.ok || !first.retryable) return first;
  await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
  return attemptProbe(service, model, classify);
}

async function attemptProbe<A>(
  service: LlmProxyService,
  model: string,
  classify: ProbeClassifier<A>,
): Promise<ProbeDispatch<A>> {
  const body: ChatCompletionRequest = {
    model, modelStrict: true, max_tokens: PROBE_MAX_TOKENS,
    messages: [{ role: 'user', content: 'Reply OK.' }],
  };
  const traceId = newTraceId();
  const result = await service.complete(body, undefined, traceId);
  if (result.response.status < 400) {
    return { ok: true, resolvedModel: result.resolvedModel, upstreamStatus: result.response.status, retryable: false };
  }

  const payload = await result.response.clone().text();
  const message = upstreamMessage(payload);
  // The ATTEMPT is the source of truth, not the envelope. A retryable failure collapses into
  // the gateway's cascade summary ("AI vendor cascade exhausted (1 attempts: …)") — which
  // states our routing internals at an operator who needed the provider's own status, and
  // prints the internal `<vendor>/<ref>` form as `openrouter/openrouter/moonshotai/kimi-k3`.
  // A strict pin has exactly ONE attempt, so read the real status and detail straight off it
  // and keep the envelope prose only as a fallback.
  const attempt = result.failovers?.[0];
  const upstreamStatus = attempt?.code ?? result.response.status;
  const error = attempt?.detail?.trim() || message || `upstream HTTP ${upstreamStatus}`;

  const alert = (result.failovers ?? []).reduce<A | null>(
    (found, f) => found ?? classify(f.vendor, f.code, f.detail ?? message),
    null,
  ) ?? classify(result.resolvedVendor, result.response.status, message);

  // A strict pin makes ONE attempt, so `failovers[0]` is the call that actually happened
  // and its diagnostic is the evidence for it. Absent when the failure predates a response
  // (timeout, network, a gateway-side refusal) — there is nothing to correlate then.
  const diagnostic: ProbeDiagnostic | undefined = attempt?.diagnostic
    ? { ...attempt.diagnostic, traceId, model: result.resolvedModel }
    : undefined;

  return {
    ok: false,
    resolvedModel: result.resolvedModel,
    upstreamStatus,
    error,
    // An alert means the OWNER can act (rejected / unentitled / out of budget) — never a
    // transient. Anything else in the failing range is the upstream having a bad minute.
    retryable: !alert && isTransientProbeStatus(upstreamStatus),
    ...(alert ? { alert } : {}),
    ...(diagnostic ? { diagnostic } : {}),
  };
}

/** Statuses that mean "the credential was accepted and something downstream of it broke" —
 *  the gateway's own cascade set, so the probe and the router agree on what is transient.
 *  `0` is the no-response/timeout case, which is equally not the credential's fault. */
function isTransientProbeStatus(status: number): boolean {
  return status === 0 || CASCADE_STATUSES.has(status);
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

  // The probe must ride the SAME egress a real completion would, or it becomes a test
  // of a path nobody uses: Kimi Code answers the Worker with an edge 403 and the
  // tenant's own runtime with a real reply, so a probe that skipped local egress would
  // paint a working connection red on every sweep.
  const service = llmProxyForPlan(env, 'free', false, {
    disablePaidOverflow: true,
    anthropicOAuthToken: resolved.anthropicOAuthToken,
    openaiCodexAuth: resolved.openaiCodexAuth,
    xaiOAuthToken: resolved.xaiOAuthToken,
    tenantVendorKeys: resolved.vendorKeys,
    hostEgress: await buildHostEgress(env, tenantId),
    byoVendorPriority: resolved.vendorPriority,
  });
  const outcome = await dispatchProbe(service, model, (vendor, status, detail) =>
    providerAlertFromFailure(vendor, status, detail, now));

  if (outcome.ok) {
    await clearProviderAuthAlert(env, tenantId, provider);
    return { provider, ok: true, status: 'ready', model: outcome.resolvedModel, upstreamStatus: outcome.upstreamStatus, checkedAt };
  }

  // Raise (not just record): a probe is often the FIRST observation of a breakage, and
  // the owner should hear about it the moment anything notices — the Test button included.
  if (outcome.alert) await raise(outcome.alert, outcome.error ?? '');
  return {
    provider, ok: false, status: outcome.retryable ? 'upstream_error' : 'failed', model,
    upstreamStatus: outcome.upstreamStatus,
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(outcome.alert ? { alert: outcome.alert } : {}),
    ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
    checkedAt,
  };
}

/**
 * The probe's verdict for ONE named OpenRouter connection (migration 0382).
 *
 * Separate from {@link ByoProbeResult} because a connection is a different unit of account:
 * it is keyed by numeric id rather than a provider, and it can be MANAGED-keyed, in which
 * case what is under test is "do these model ids still route", not "is the tenant's
 * credential good". `ownKey` is what tells the two apart in the operator-facing copy.
 */
export interface OpenRouterConnectionProbeResult {
  connectionId: number;
  ok: boolean;
  /** `ready` on success, else a short machine status the UI localizes.
   *
   *  `key_unresolved` — the connection claims a key that could not be applied to any of its
   *  models (it no longer decrypts, or every one of its ids is already claimed by a
   *  HIGHER-precedence connection), which is exactly the case where a green verdict would
   *  have been a lie about which account pays.
   *
   *  `upstream_error` — the key WORKED: OpenRouter accepted it and the model provider then
   *  errored (a 502 from Moonshot, say). Nothing about the registration is wrong, so calling
   *  this "failed" sends the owner to re-enter a key that is fine. */
  status: 'ready' | 'not_found' | 'no_test_model' | 'key_unresolved' | 'upstream_error' | 'failed';
  /** The bare OpenRouter id the probe pinned (absent when it never got that far). */
  model?: string;
  /** Models OpenRouter refused for a model/account usage limit while another selected
   *  model remained usable. These are model-level routing failures; they must not turn the
   *  whole connection into a disabled account unless every selected model appears here. */
  limitedModels?: string[];
  /** True when the dispatch rode the tenant's OWN OpenRouter key rather than ours. */
  ownKey: boolean;
  upstreamStatus?: number;
  error?: string;
  /** The persisted owner-actionable alert, when the failure was one. */
  alert?: ConnectionAuthAlert;
  /** Redacted upstream evidence for a failed probe — see {@link ProbeDiagnostic}. Same
   *  shape as the provider probe's: both ride the one `dispatchProbe`, so a connection
   *  failure is as reportable to a provider as a provider failure is. */
  diagnostic?: ProbeDiagnostic;
  checkedAt: string;
}

/**
 * Probe ONE OpenRouter connection by dispatching a tiny strict-pinned request down the same
 * path a real completion takes — the connection's own model list, on the connection's own
 * key when it has one — and persist the verdict.
 *
 * Why the proxy is built from `[connection]` alone rather than the tenant's whole credential
 * set: a test must answer a question about THIS registration. Seeded with every connection,
 * a cascade could satisfy the request from a different one (or from a connected provider) and
 * report green for a registration that serves nothing — the exact failure mode the provider
 * probe's strict pin exists to prevent.
 *
 * Side effects mirror {@link probeByoProvider} exactly, on the connection half of the alert
 * keyspace: an owner-actionable failure records (and, unless suppressed, mails) an alert so
 * the Integrations card stops claiming the registration is fine; a success clears any stale
 * one; a transient blip leaves the prior verdict alone rather than flapping the UI.
 */
export async function probeOpenRouterConnection(
  env: Env,
  tenantId: number,
  connectionId: number,
  opts: Pick<ProbeOptions, 'notify'> = {},
): Promise<OpenRouterConnectionProbeResult> {
  const notify = opts.notify ?? true;
  const checkedAt = new Date().toISOString();
  const now = Date.parse(checkedAt);
  const connections = await listOpenRouterConnections(env, tenantId);
  const connection = connections.find((c) => c.id === connectionId);
  if (!connection) return { connectionId, ok: false, status: 'not_found', ownKey: false, checkedAt };
  if (connection.models.length === 0) {
    return { connectionId, ok: false, status: 'no_test_model', ownKey: connection.hasKey, checkedAt };
  }
  const raise = (alert: ConnectionAuthAlert, detail: string) => notify
    ? raiseConnectionAuthAlert(env, tenantId, alert, connection.label, detail).then(() => undefined)
    : recordConnectionAuthAlert(env, tenantId, alert);

  // Restrict the key map to THIS connection's ids. `resolveOpenRouterConnectionKeys` returns
  // the tenant-wide routing truth (first connection to claim a model owns it), so narrowing
  // it here is what makes "tested on my key" mean the key of the connection under test.
  let modelKeys: Record<string, string> = {};
  if (connection.hasKey) {
    const resolved = await resolveOpenRouterConnectionKeys(env, tenantId);
    modelKeys = Object.fromEntries(
      connection.models.filter((m) => resolved[m]).map((m) => [m, resolved[m]!]),
    );
    if (Object.keys(modelKeys).length === 0) {
      // 100% owner-actionable and nothing was ever sent upstream — the same shape the
      // provider probe gives an unresolvable credential, so it alerts rather than being
      // reported as a bare "could not run".
      const error = 'The saved OpenRouter key could not be applied to any model in this connection — '
        + 're-enter the key, or check whether a higher-priority connection already claims these models.';
      const alert: ConnectionAuthAlert = { connectionId, reason: 'unresolved', status: 0, vendor: 'openrouter', at: now };
      await raise(alert, error);
      return { connectionId, ok: false, status: 'key_unresolved', ownKey: true, error, alert, checkedAt };
    }
  }

  // A keyed connection may have models shadowed by a higher-priority registration. Test only
  // ids that THIS connection's key really serves; falling through to a shadowed id would
  // silently verify it on Builderforce's managed key.
  const candidates = connection.hasKey
    ? connection.models.filter((model) => !!modelKeys[model])
    : connection.models;
  const ownKey = connection.hasKey;
  const service = llmProxyForPlan(env, 'free', false, {
    disablePaidOverflow: true,
    openRouterConnections: [connection],
    ...(Object.keys(modelKeys).length ? { openRouterModelKeys: modelKeys } : {}),
  });
  const limitedModels: string[] = [];
  let lastFailure: { bare: string; outcome: ProbeDispatch<ConnectionAuthAlert> } | null = null;

  for (const bare of candidates) {
    const outcome = await dispatchProbe(service, connectionModelRef(bare), (vendor, status, detail) =>
      connectionAlertFromFailure(connectionId, vendor, status, detail, now));

    if (outcome.ok) {
      // One usable model means the CONNECTION is usable. Keep the limited ids in the
      // verdict so the operator can see why routing skipped them, but clear the old
      // connection-wide alert and leave the remaining models available to the cascade.
      await clearConnectionAuthAlert(env, tenantId, connectionId);
      return {
        connectionId, ok: true, status: 'ready', model: bare, ownKey,
        upstreamStatus: outcome.upstreamStatus,
        ...(limitedModels.length ? { limitedModels } : {}),
        checkedAt,
      };
    }

    lastFailure = { bare, outcome };
    if (outcome.alert?.reason === 'capacity') {
      limitedModels.push(bare);
      continue;
    }

    // Rejected/unentitled credentials are connection-wide, not model limiters. Stop after
    // one request; trying every selected model would spend money to repeat the same answer.
    if (outcome.alert) {
      await raise(outcome.alert, outcome.error ?? '');
      return {
        connectionId, ok: false, status: 'failed', model: bare, ownKey,
        upstreamStatus: outcome.upstreamStatus,
        ...(outcome.error ? { error: outcome.error } : {}),
        alert: outcome.alert,
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
        checkedAt,
      };
    }
    // A model-provider outage can also be bypassed by the next configured model. Continue
    // walking; if none work, report the last transient without disabling the connection.
  }

  const failed = lastFailure!;
  const allModelsLimited = limitedModels.length === candidates.length;
  if (allModelsLimited && failed.outcome.alert) {
    await raise(failed.outcome.alert, failed.outcome.error ?? '');
  }
  return {
    connectionId, ok: false,
    status: allModelsLimited ? 'failed' : 'upstream_error',
    model: failed.bare, ownKey, upstreamStatus: failed.outcome.upstreamStatus,
    ...(limitedModels.length ? { limitedModels } : {}),
    ...(failed.outcome.error ? { error: failed.outcome.error } : {}),
    ...(allModelsLimited && failed.outcome.alert ? { alert: failed.outcome.alert } : {}),
    ...(failed.outcome.diagnostic ? { diagnostic: failed.outcome.diagnostic } : {}),
    checkedAt,
  };
}

/**
 * Probe every OpenRouter connection a tenant holds, reporting the PRIOR alert alongside each
 * verdict so the daily sweep can act on the transition rather than the state — the same
 * contract {@link probeTenantByoProviders} follows, and the reason a registration that has
 * been broken (and already reported) for a week stays email-quiet.
 *
 * Sequential for the same reason: each probe is a real upstream call, and a burst of parallel
 * ones against a single OpenRouter account is a good way to earn a rate limit that then looks
 * like a broken credential.
 */
export async function probeTenantOpenRouterConnections(
  env: Env,
  tenantId: number,
  opts: Pick<ProbeOptions, 'notify'> = {},
): Promise<Array<{ result: OpenRouterConnectionProbeResult; label: string; previousAlert: ConnectionAuthAlert | null }>> {
  const connections = await listOpenRouterConnections(env, tenantId);
  const out: Array<{ result: OpenRouterConnectionProbeResult; label: string; previousAlert: ConnectionAuthAlert | null }> = [];
  for (const connection of connections) {
    const previousAlert = await loadConnectionAuthAlert(env, tenantId, connection.id).catch(() => null);
    const result = await probeOpenRouterConnection(env, tenantId, connection.id, opts)
      .catch((err): OpenRouterConnectionProbeResult => ({
        connectionId: connection.id, ok: false, status: 'failed', ownKey: connection.hasKey,
        error: err instanceof Error ? err.message : 'probe failed',
        checkedAt: new Date().toISOString(),
      }));
    out.push({ result, label: connection.label, previousAlert });
  }
  return out;
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
