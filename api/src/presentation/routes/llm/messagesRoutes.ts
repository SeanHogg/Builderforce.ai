/**
 * Vendor-native completion surfaces beside the OpenAI-compatible chat endpoint:
 *
 * POST /v1/responses — OpenAI Responses passthrough on the tenant's ChatGPT/Codex
 *                      subscription.
 * POST /v1/messages  — Anthropic Messages for the BuilderForce-V2 (Claude Agent SDK)
 *                      runner: BYO Anthropic passthrough, else our pool via the
 *                      Messages ⇄ OpenAI bridge.
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { RequestValidationError } from '../../../domain/shared/errors';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { ResponsesBody, gatewayRefusalBody, parseGatewayBody } from '../llmRoutes.schemas';
import { newTraceId, productNameForPlan, type ChatCompletionRequest } from '../../../application/llm/LlmProxyService';
import { normalizeByoProvider } from '../../../application/llm/usageLedger';
import { vendorForModel } from '../../../application/llm/vendors';
import {
  isCloudAgentExecutionRequest,
  classifyCloudByoAnthropic,
  cloudByoFailureBody,
  CLOUD_BYO_FAILURE_STATUS,
} from '../../../application/llm/cloudByoPolicy';
import {
  resolveAnthropicResolution,
  resolveOpenAICodexResolution,
  resolveTenantVendorKeys,
  byoVendorIdsFromCredentials,
} from '../../../application/llm/tenantProviderKeyService';
import { buildHostEgress } from '../../../application/llm/hostEgress';
import { withClaudeCodeSystemPrompt, ANTHROPIC_OAUTH_BETA } from '../../../application/llm/anthropicOAuth';
import { parseAnthropicSseUsage } from '../../../application/llm/anthropicSseUsage';
import {
  anthropicToOpenAiRequest,
  openAiToAnthropicMessage,
  createAnthropicStreamEncoder,
  pipeOpenAiSseToAnthropic,
  type AnthropicMessagesRequest,
} from '../../../application/llm/anthropicMessagesBridge';
import { proxyForCompletion, tenantCanSelfFund } from '../../../application/llm/gatewayCompletionProxy';
import { isPaidOverflowExhausted, logFailovers, logProviderAuthAlerts, logUsage } from '../../../application/llm/gatewayUsageLog';
import { enforceTokenCaps, resolveUsageSurface, resolveWorkHints } from './gatewayGuards';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountMessagesRoutes(router: Hono<HonoEnv>): void {
  // OpenAI Responses-compatible surface backed by the tenant's own ChatGPT/Codex
  // subscription. This is deliberately separate from /v1/chat/completions: Codex
  // subscription tokens are valid for the Codex Responses backend, not the paid
  // api.openai.com Chat Completions API used by an ordinary OpenAI API key.
  router.post('/v1/responses', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const resolution = await resolveOpenAICodexResolution(c.env, access.tenantId);
    if (!resolution.auth) {
      return c.json({
        error: {
          message: resolution.reason
            ? `OpenAI subscription credential is ${resolution.reason}; reconnect it in Settings → API keys.`
            : 'Connect a ChatGPT/Codex subscription in Settings → API keys first.',
          type: 'authentication_error',
          code: `openai_subscription_${resolution.reason ?? 'not_connected'}`,
        },
      }, 401);
    }
    // Forwarded verbatim; a miss keeps this endpoint's OpenAI-style error envelope.
    const body = await parseGatewayBody(c, ResponsesBody);
    if (body instanceof RequestValidationError) {
      return c.json({ error: { message: gatewayRefusalBody(body, 'Invalid JSON body').error, type: 'invalid_request_error' } }, 400);
    }
    const upstream = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${resolution.auth.accessToken}`,
        'ChatGPT-Account-Id': resolution.auth.accountId,
        accept: c.req.header('accept') ?? 'application/json',
      },
      body: JSON.stringify({ ...body, store: false }),
    });
    const headers = new Headers(upstream.headers);
    headers.delete('set-cookie');
    headers.delete('content-encoding');
    return new Response(upstream.body, { status: upstream.status, headers });
  });

  // -----------------------------------------------------------------------
  // POST /v1/messages — Anthropic-Messages endpoint for the BuilderForce-V2
  // (Claude Agent SDK) runner, which points ANTHROPIC_BASE_URL at `${api}/llm`.
  // The Agent SDK only needs an Anthropic-Messages-compatible endpoint + any
  // auth token (the Ollama pattern), so a tenant Anthropic key is OPTIONAL:
  //   • BYO key present → pass through to api.anthropic.com with that key.
  //   • No key (default) → serve from OUR multi-vendor model pool by translating
  //     Messages ⇄ our OpenAI-compatible proxy.
  // Usage is metered on the tenant's ledger either way.
  // -----------------------------------------------------------------------
  router.post('/v1/messages', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }

    const bodyText = await c.req.text();
    let parsed: AnthropicMessagesRequest & { stream?: boolean; model?: unknown };
    try { parsed = JSON.parse(bodyText) as AnthropicMessagesRequest & { stream?: boolean; model?: unknown }; }
    catch { return c.json({ error: 'invalid JSON body' }, 400); }
    const streamed = parsed.stream === true;
    const model = typeof parsed.model === 'string' ? parsed.model : 'unknown';
    const product = productNameForPlan(access.effectivePlan, access.premiumOverride);
    const idempotencyKey = c.req.header('idempotency-key') ?? null;
    // Which ticket/project this spend belongs to — validated against THIS tenant, so a
    // caller cannot bill another workspace's ticket. Resolved once for both branches.
    const workHints = await resolveWorkHints(c, access, (parsed as { metadata?: unknown }).metadata);

    // Resolve the tenant's Anthropic credential — an API key OR a connected
    // Claude Pro/Max subscription (OAuth, auto-refreshed). Both pass through to
    // real Anthropic; they differ only in the auth header and (for OAuth) the
    // required Claude Code system-prompt injection + oauth beta header. The full
    // resolution (not just the auth) is taken so a CONNECTED-but-unusable credential
    // can be reported with its reason rather than looking like "nothing connected".
    const anthropicResolution = await resolveAnthropicResolution(c.env, access.tenantId);

    // ── Cloud-agent execution: fail closed, never bill the platform key ─────
    // A cloud agent run executes on the WORKSPACE's own credential by contract
    // (GAP-B2/B4). Without this gate a missing/undecryptable key fell through to the
    // Messages⇄OpenAI translation below and served the turn from the platform pool —
    // correct for ordinary gateway traffic, a billing leak for a cloud run. Scoped to
    // requests that DECLARE themselves a cloud execution, so web/VSIX/on-prem chat
    // keeps its platform-pool floor unchanged.
    if (isCloudAgentExecutionRequest((name) => c.req.header(name))) {
      const gate = classifyCloudByoAnthropic(anthropicResolution);
      if (!gate.ok) return c.json(cloudByoFailureBody(gate), CLOUD_BYO_FAILURE_STATUS);
    }
    const anthropicAuth = anthropicResolution.auth;

    // ── BYO Anthropic credential → pass through to real Anthropic ───────────
    if (anthropicAuth) {
      const isOAuth = anthropicAuth.mode === 'oauth';
      // OAuth subscription tokens require the Claude Code identity as the first
      // system block; an API key passes the caller's body through verbatim.
      const outboundBody = isOAuth
        ? JSON.stringify(withClaudeCodeSystemPrompt(parsed as unknown as Record<string, unknown>))
        : bodyText;
      // Merge any caller-supplied beta flags with the mandatory oauth beta.
      const callerBeta = c.req.header('anthropic-beta');
      const betaHeader = isOAuth
        ? (callerBeta && !callerBeta.includes(ANTHROPIC_OAUTH_BETA) ? `${callerBeta},${ANTHROPIC_OAUTH_BETA}` : ANTHROPIC_OAUTH_BETA)
        : callerBeta;
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isOAuth
            ? { authorization: `Bearer ${anthropicAuth.accessToken}` }
            : { 'x-api-key': anthropicAuth.key }),
          'anthropic-version': c.req.header('anthropic-version') ?? '2023-06-01',
          ...(betaHeader ? { 'anthropic-beta': betaHeader } : {}),
        },
        body: outboundBody,
      });

      if (!streamed) {
        const json = (await upstream.json().catch(() => null)) as
          | { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
          | null;
        if (upstream.ok && json?.usage) {
          const u = json.usage;
          logUsage(c.env, c.executionCtx, {
            tenantId: access.tenantId, userId: access.userId, llmProduct: product, model,
            retries: 0, streamed: false,
            usage: {
              promptTokens: u.input_tokens ?? 0,
              completionTokens: u.output_tokens ?? 0,
              totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              cacheReadTokens: u.cache_read_input_tokens ?? 0,
              cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            },
            metadata: { engine: 'agent' }, idempotencyKey, useCase: 'agent',
            tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId, ...workHints },
            // This branch IS the tenant's connected Anthropic credential serving the
            // call, so name it — an unstamped byo row can't attribute to an integration.
            byo: true, byoProvider: 'anthropic', surface: resolveUsageSurface(c, access),
          });
        }
        return new Response(JSON.stringify(json ?? { error: 'upstream_error' }), {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (!upstream.body) return c.json({ error: 'no upstream body' }, 502);
      const [toClient, toMeter] = upstream.body.tee();
      c.executionCtx.waitUntil((async () => {
        try {
          const text = await new Response(toMeter).text();
          logUsage(c.env, c.executionCtx, {
            tenantId: access.tenantId, userId: access.userId, llmProduct: product, model,
            retries: 0, streamed: true, usage: parseAnthropicSseUsage(text),
            metadata: { engine: 'agent' }, idempotencyKey, useCase: 'agent',
            tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId, ...workHints },
            byo: true, byoProvider: 'anthropic', surface: resolveUsageSurface(c, access),
          });
        } catch (error) { /* metering is best-effort */
          reportCaughtError(error, { source: 'presentation/routes/llm/messagesRoutes.ts', operation: 'messagesByoStreamMeter' });
        }
      })());
      return new Response(toClient, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/event-stream', 'cache-control': 'no-cache' },
      });
    }

    // ── No BYO ANTHROPIC key → serve via Messages ⇄ OpenAI translation ──────
    // Resolved BEFORE the pool-key check, not after: the tenant may still bring a
    // non-Anthropic account (Kimi, OpenAI, Meta, …), and refusing them for a missing
    // OPENROUTER key would blame our pool for a turn that never needed it.
    const tenantVendorKeys = await resolveTenantVendorKeys(c.env, access.tenantId);
    const isPro = access.premiumOverride || access.effectivePlan !== 'free';
    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey && !tenantCanSelfFund({ vendorKeys: tenantVendorKeys })) {
      return c.json({ error: 'LLM proxy not configured', code: 'proxy_unconfigured' }, 503);
    }

    // Our-models path bills US (not the tenant's Anthropic key), so apply the
    // SAME daily + monthly token caps as /v1/chat/completions — and close the
    // funded overflow path once the tenant's overflow $ cap is hit.
    const capResult = await enforceTokenCaps(c, access);
    if ('blocked' in capResult) return capResult.blocked;
    const disablePaidOverflow = await isPaidOverflowExhausted(c.env, access);

    const openaiBody = anthropicToOpenAiRequest(parsed);
    const traceId = newTraceId();
    const messageId = `msg_${traceId}`;
    // `tenantVendorKeys` was resolved above (before the pool-key check) — the tenant
    // has no BYO Anthropic credential here (handled earlier) but may still bring
    // OpenAI/Google/Kimi/…, overlaid so a translated turn landing on their vendor
    // rides the tenant's own account ($0 to us, metered byo).
    // Determinism for non-Anthropic on-prem BYO: if the requested model belongs to
    // a vendor the tenant has connected, HARD-PIN it (modelStrict) so the run rides
    // their own account instead of the gateway silently cascading onto our free
    // pool. Mirrors the Anthropic passthrough's "runs on the tenant's account, period"
    // guarantee for OpenAI/Google. A bare/mismatched model just stays a soft hint.
    const byoVendors = byoVendorIdsFromCredentials({ vendorKeys: tenantVendorKeys });
    if (typeof parsed.model === 'string' && byoVendors.has(vendorForModel(parsed.model))) {
      (openaiBody as { modelStrict?: boolean }).modelStrict = true;
    }
    // Same routing path as /v1/chat/completions: a translated Anthropic request that
    // carried `tools` is an agentic turn and floors onto the paid coder backstop
    // rather than the lite general backstop. (BYO-Claude turns were served above.)
    const service = proxyForCompletion(c.env, access, openaiBody as unknown as ChatCompletionRequest, { disablePaidOverflow, tenantVendorKeys, hostEgress: await buildHostEgress(c.env, access.tenantId) });
    const result = await service.complete(openaiBody as unknown as ChatCompletionRequest, undefined, traceId);
    logFailovers(c.env, c.executionCtx, result.failovers, { tenantId: access.tenantId, requestId: traceId });
    logProviderAuthAlerts(c.env, c.executionCtx, access.tenantId, result.failovers);

    const usageRow = {
      tenantId: access.tenantId, userId: access.userId, llmProduct: product, model: result.resolvedModel,
      retries: result.retries,
      metadata: { engine: 'agent', resolvedModel: result.resolvedModel }, idempotencyKey,
      useCase: 'agent', tenantApiKeyId: access.tenantApiKeyId,
      attribution: { agentHostId: access.agentHostId, ...workHints }, traceId,
      paidOverflow: result.paidOverflow,
      byo: result.byoFunded ?? false,
      byoProvider: result.byoFunded ? normalizeByoProvider(result.resolvedVendor) : null,
    };

    if (streamed && result.response.body) {
      const encoder = createAnthropicStreamEncoder({ messageId, model: result.resolvedModel });
      const stream = pipeOpenAiSseToAnthropic(result.response.body, encoder, (usage) => {
        logUsage(c.env, c.executionCtx, { ...usageRow, streamed: true, usage, surface: resolveUsageSurface(c, access) });
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-builderforce-model': result.resolvedModel },
      });
    }

    const openaiJson = await result.response.json().catch(() => null) as Record<string, unknown> | null;
    logUsage(c.env, c.executionCtx, {
      ...usageRow,
      streamed: false,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      surface: resolveUsageSurface(c, access),
    });
    return new Response(JSON.stringify(openAiToAnthropicMessage(openaiJson, result.resolvedModel, messageId)), {
      status: result.response.status,
      headers: { 'content-type': 'application/json', 'x-builderforce-model': result.resolvedModel },
    });
  });
}
