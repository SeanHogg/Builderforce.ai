/**
 * BYO provider credentials — tenant-managed provider auth. Two shapes:
 *   • API key (paste `sk-ant-…`), or
 *   • a SUBSCRIPTION via OAuth (connect your own Claude / ChatGPT / SuperGrok account).
 *
 * GET    /provider-keys                       → configured providers + auth type + priority
 * GET    /byo-precedence                      → the mixed provider/connection precedence
 * GET    /provider-keys/:provider/status      → credential health + 30-day usage
 * POST   /provider-keys/:provider/test        → one tiny strict-pinned probe
 * PUT    /provider-keys/priority              → set BYO precedence { order: ref[] }
 * PUT    /provider-keys/:provider             → set/replace the API key { apiKey }
 * (subscription OAuth, selected-model and local-credential routes are mounted from their own modules)
 * DELETE /provider-keys/:provider             → remove the credential
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { parseOptionalBody } from '../requestBody';
import { ByoPrecedenceBody, ProviderKeyBody } from '../llmRoutes.schemas';
import {
  setTenantProviderKey,
  resolveTenantLlmCredentials,
  listTenantProviderKeys,
  deleteTenantProviderKey,
  isSupportedProvider,
} from '../../../application/llm/tenantProviderKeyService';
import { USAGE_WINDOW_DAYS } from '../../../application/llm/openRouterConnectionService';
import { listByoPrecedence, parsePrecedenceRef, setByoPrecedence } from '../../../application/llm/byoPrecedence';
import { clearProviderAuthAlert, loadProviderAuthAlert } from '../../../application/llm/providerAuthAlerts';
import { probeByoProvider } from '../../../application/llm/byoCredentialHealth';
import { resolveProviderKeyHealth } from '../../../application/llm/providerKeyHealth';
import { composeSelfHostedCredential, isLocalRuntimeProvider } from '../../../application/llm/selfHostedCredential';
import { byoProviderUsage30d, byoUsageByProvider } from '../../../application/llm/gatewayUsageLog';
import { mountProviderModelRoutes } from '../providerModelRoutes';
import { mountSubscriptionOAuthRoutes } from '../subscriptionOAuthRoutes';
import { mountLocalCredentialRoutes } from '../localCredentialRoutes';
import { KIMI_CODE_API_HOST } from '@builderforce/kimi-oauth';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountProviderKeyRoutes(router: Hono<HonoEnv>): void {
  router.get('/provider-keys', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const details = await listTenantProviderKeys(c.env, access.tenantId);
    // Attach any "reconnect this account" alert to the LIST, not just the per-provider
    // status drawer — an operator who never opens the drawer would otherwise never learn
    // that a connected account has been silently rejected on every call. Bounded fan-out
    // (one entry per CONNECTED provider, ≤9) and each lookup is read-through cached, so
    // this stays a single cheap read in the steady state.
    const [alerts, usageByProvider] = await Promise.all([
      Promise.all(details.map((d) =>
        loadProviderAuthAlert(c.env, access.tenantId, d.provider).catch(() => null))),
      byoUsageByProvider(c.env, access.tenantId),
    ]);
    // `providers` (id array) kept for backward compatibility; `details` carries auth type
    // + tenant-set BYO precedence (ordered by `priority`, most-preferred first).
    return c.json({
      providers: details.map((d) => d.provider),
      details: details.map((d, i) => ({
        ...d,
        ...(alerts[i] ? { authAlert: alerts[i] } : {}),
        usage: usageByProvider.get(d.provider) ?? {
          periodDays: USAGE_WINDOW_DAYS, requests: 0, tokens: 0, lastUsedAt: null,
        },
      })),
      usageWindowDays: USAGE_WINDOW_DAYS,
    });
  });

  router.get('/byo-precedence', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    return c.json({ entries: await listByoPrecedence(c.env, access.tenantId) });
  });

  // Credential health plus tenant-observed usage for the provider details drawer.
  // This does not expose or transmit the stored secret.
  router.get('/provider-keys/:provider/status', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    // `authAlert` is the DISPATCH-observed health signal, and it answers a question
    // `configured`/`usable` structurally cannot: those describe whether the stored
    // credential RESOLVES, and a ChatGPT account whose plan lapsed still resolves
    // perfectly — it just 403s on every call. Without this the card reads
    // "● connected" forever while the account silently serves nothing.
    const [details, creds, authAlert] = await Promise.all([
      listTenantProviderKeys(c.env, access.tenantId),
      resolveTenantLlmCredentials(c.env, access.tenantId),
      loadProviderAuthAlert(c.env, access.tenantId, provider),
    ]);
    // ONE verdict, shared with the drawer's own precedence rules: a credential that
    // decrypts but is refused upstream is not ready, and neither is one whose vendor is
    // reachable only from a runtime of the tenant's own while none is online — the read
    // used to say `ready` there while the Test button, one line below, said otherwise.
    const { status, configured, usable } = await resolveProviderKeyHealth(c.env, access.tenantId, provider, { details, creds, authAlert });
    const usage = await byoProviderUsage30d(c.env, access.tenantId, provider);
    return c.json({
      provider, configured, usable, status,
      // Only meaningful while the credential is still configured — a removed one has
      // nothing to reconnect, and the alert is cleared on removal anyway.
      ...(configured && authAlert ? { authAlert } : {}),
      usage,
    });
  });

  // Make one tiny, strict-pinned request through the same routing path as chat. The probe
  // itself — model choice, dispatch, failure classification, and the alert write/clear that
  // keeps the Integrations card honest — lives in `probeByoProvider`, because the DAILY
  // sweep (runByoCredentialHealthCron) must reach the identical verdict this button does.
  // When they disagreed, the page showed five green cards next to a failing test.
  router.post('/provider-keys/:provider/test', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    const probe = await probeByoProvider(c.env, access.tenantId, provider);
    if (probe.ok) {
      return c.json({ ok: true, status: probe.status, model: probe.model, testedAt: probe.checkedAt });
    }
    return c.json({
      ok: false,
      status: probe.status,
      // Nothing was ever sent: this provider is only reachable from the tenant's own
      // machine (Kimi's edge refuses our cloud egress outright) and none is connected, so
      // the gateway skipped the candidate instead of spending a doomed call. That makes it
      // the ONE branch that is not a verdict on the credential — say so, and give the
      // remedy the owner can actually act on.
      error: probe.status === 'local_egress_required'
        ? `${provider} is reachable only from a machine of your own: Kimi Code subscription keys are licensed for personal interactive clients, and Kimi's edge blocks the hosted Builderforce gateway before it can present a key. Nothing was sent, so this says nothing about your key. Connect a Builderforce runtime (the Agents page, /agents — Quick start) and this account routes through YOUR machine — the client the subscription is for. A Moonshot Open Platform key is the alternative if you would rather not run one.`
        : probe.status === 'upstream_error'
        ? `Your ${provider} credential worked — it was accepted and the request was routed. ${probe.model ?? 'The model'} then returned HTTP ${probe.upstreamStatus}, twice. That is an upstream outage on that model, not a problem with this account: retry shortly.`
        : probe.error
        ? probe.alert?.reason === 'capacity'
          ? provider === 'kimi'
            ? `Kimi connection test paused: Kimi reports that this subscription's usage allowance is exhausted. Check the Kimi Code Console for the reset time. The key is valid and does not need to be replaced. (${probe.error})`
            : `${provider} connection test paused: this account's usage allowance is depleted (HTTP ${probe.alert.status}). Check the provider's Usage page for the reset time; to continue now, buy credits or enable auto top-up, or upgrade the provider plan.`
          : probe.alert?.reason === 'not_entitled'
          // `edgeBlocked` is the transport's own verdict on the response body, so this
          // no longer depends on an HTML tag surviving into a 240-char truncated detail
          // string — the regex silently missed the case it existed for whenever the edge
          // page led with a comment, a BOM, or a long `<meta>` block.
          // An edge block that got THIS far was made from the tenant's connected runtime —
          // with none online the candidate never dispatches (`local_egress_required`
          // above), so "you have no runtime" is no longer a reachable reading of a 403.
          ? provider === 'kimi' && probe.diagnostic?.edgeBlocked
            ? `Kimi's edge refused this request even though it was made from your connected Builderforce runtime, not from our cloud. That points at the runtime machine's own network rather than at this key — check whether it can reach ${KIMI_CODE_API_HOST} directly. A Moonshot Open Platform key works from anywhere if you need a route now.`
            : provider === 'xai'
            ? `xAI connection test failed: this account cannot use ${probe.model ?? 'the selected model'} (HTTP ${probe.alert.status}). Check the account's SuperGrok/API access, or use an xAI API key.`
            : provider === 'kimi'
              ? `Kimi refused ${probe.model ?? 'the selected model'} (HTTP ${probe.alert.status}). Kimi's response: ${probe.error}`
              : `${provider} connection test failed: this account cannot use ${probe.model ?? 'the selected model'} (HTTP ${probe.alert.status}). Provider response: ${probe.error}`
          : `${provider} connection test failed: ${probe.error}`
        : `${provider} connection test could not run: ${probe.status.replaceAll('_', ' ')}.`,
      code: 'provider_test_failed',
      testedAt: probe.checkedAt,
      // Echo the alert the probe just persisted so the card repaints from THIS response
      // instead of waiting for the status read's 60s read-through window to lapse.
      ...(probe.alert ? { authAlert: probe.alert } : {}),
      // Redacted upstream evidence — endpoint, the provider's own correlation headers,
      // whether an EDGE refused the call before the key was read, and our trace id. This
      // is what an operator attaches to a provider support ticket; without it the only
      // artifact they had was our prose about the failure.
      ...(probe.diagnostic ? { diagnostic: probe.diagnostic } : {}),
      details: { provider, model: probe.model, upstreamStatus: probe.upstreamStatus },
    });
  });

  // Set the BYO precedence — the ordered provider list (most-preferred first) the
  // auto-select cloud pin leads its connected flagships by (e.g. Meta first). Registered
  // BEFORE `:provider` so the literal `priority` segment isn't captured as a provider id.
  router.put('/provider-keys/priority', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const body = await parseOptionalBody(c, ByoPrecedenceBody);
    if (!Array.isArray(body.order)) return c.json({ error: 'order must be an array' }, 400);
    const parsed = body.order.map(parsePrecedenceRef);
    if (parsed.some((entry) => entry === null)) {
      return c.json({ error: 'order contains an invalid provider or OpenRouter connection ref' }, 400);
    }
    await setByoPrecedence(c.env, access.tenantId, parsed as NonNullable<(typeof parsed)[number]>[]);
    return c.json({ ok: true, order: body.order });
  });

  router.put('/provider-keys/:provider', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    const body = await parseOptionalBody(c, ProviderKeyBody);

    // A self-hosted runtime (`credential: 'local_runtime'` in the shared provider data —
    // self-hosted Ollama, FreeToken) stores the composed `<apiKey>::<baseUrl>::<model>`
    // its vendor splits back apart, never a bare key. See `selfHostedCredential.ts`.
    if (isLocalRuntimeProvider(provider)) {
      const credential = composeSelfHostedCredential(body);
      if (!credential.ok) return c.json({ error: credential.error }, 400);
      await setTenantProviderKey(c.env, access.tenantId, provider, credential.value, access.userId);
      await clearProviderAuthAlert(c.env, access.tenantId, provider);
      return c.json({ ok: true, provider });
    }

    const apiKey = body.apiKey?.trim();
    if (!apiKey) return c.json({ error: 'apiKey is required' }, 400);
    await setTenantProviderKey(c.env, access.tenantId, provider, apiKey, access.userId);
    // A replaced credential invalidates the old one's rejection notice — otherwise
    // the card would keep telling the operator to reconnect an account they just did.
    await clearProviderAuthAlert(c.env, access.tenantId, provider);
    return c.json({ ok: true, provider });
  });

  // The three subscription connects (Anthropic / OpenAI / xAI) are ONE flow that
  // differs only by provider data — it lives in its own module rather than as
  // three near-identical handler pairs here. See subscriptionOAuthRoutes.
  mountSubscriptionOAuthRoutes(router, { requireTenantAccess, respondToAccessError });

  // Which of a connected provider's models routing uses, in order (1165) — its own module.
  mountProviderModelRoutes(router, { requireTenantAccess, respondToAccessError });

  // A connected subscription's short-lived token for a runtime on the member's own
  // machine (Kimi refuses our egress; the editor and Rovr call it directly) — its own module.
  mountLocalCredentialRoutes(router, { requireTenantAccess, respondToAccessError });

  router.delete('/provider-keys/:provider', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    await deleteTenantProviderKey(c.env, access.tenantId, provider);
    // Nothing left to reconnect — retire the alert with the credential.
    await clearProviderAuthAlert(c.env, access.tenantId, provider);
    return c.json({ ok: true });
  });
}
