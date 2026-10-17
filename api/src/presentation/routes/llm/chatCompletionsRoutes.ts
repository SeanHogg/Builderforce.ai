/**
 * POST /v1/chat/completions — the OpenAI-compatible, multi-vendor cascade.
 *
 * The handler is the sequence; its steps live beside it: the logged-out guest path
 * (`guestChat`), the pre-dispatch gates (`chatCompletionGates`), model-ref expansion
 * and the response derivations (`application/llm/gatewayChatSupport`), and the
 * header/envelope shaping (`chatCompletionResponse`).
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { RequestValidationError } from '../../../domain/shared/errors';
import { getLimits } from '../../../domain/tenant/PlanLimits';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { ChatCompletionBody, gatewayRefusalBody, parseGatewayBody } from '../llmRoutes.schemas';
import {
  newTraceId,
  productNameForPlan,
  estimateRequestTokens,
  type ChatCompletionRequest,
} from '../../../application/llm/LlmProxyService';
import { parseClientReasoningIntent } from '../../../application/llm/reasoningCapability';
import { normalizeByoProvider } from '../../../application/llm/usageLedger';
import { logTrace, backfillTraceUsage, backfillTraceResponseBody } from '../../../application/llm/traceLogger';
import { wrapStreamForTrace } from '../../../application/llm/streamTrace';
import { toTenantPlan } from '../../../application/tenant/featureEntitlements';
import { requestDb } from '../../../application/shared/dbHandle';
import { roleRoutingStats } from '../../../application/llm/routingTable';
import {
  createCacheIdempotencyStore,
  IDEMPOTENCY_KEY_HEADER,
  isStorableStatus,
  parseIdempotencyKey,
  requestFingerprint,
} from '../../../application/shared/idempotentReplay';
import { resolveTenantLlmCredentials, byoVendorIdsFromCredentials } from '../../../application/llm/tenantProviderKeyService';
import { buildHostEgress } from '../../../application/llm/hostEgress';
import { byoRoutingOptions } from '../../../application/llm/tenantProxy';
import { pricesForCall } from '../../../application/llm/catalogView';
import { GUEST_TOKEN_PREFIX } from '../../../application/guest/guestToken';
import { proxyForCompletion, tenantCanSelfFund } from '../../../application/llm/gatewayCompletionProxy';
import { expandGatewayModelRefs, recordGatewayChatModelActivity } from '../../../application/llm/gatewayChatSupport';
import { isPaidOverflowExhausted, logFailovers, logProviderAuthAlerts, logUsage } from '../../../application/llm/gatewayUsageLog';
import { isModelRole } from '@builderforce/agent-tools';
import { isArcStage } from '@builderforce/workload';
import { enforceTokenCaps, resolveUsageSurface, resolveWorkHints } from './gatewayGuards';
import { gatePremiumSelection, gateStrictPin, replayIdempotentRequest } from './chatCompletionGates';
import { buildCompletionEnvelope, buildCompletionHeaders, stampTraceIdOnError } from './chatCompletionResponse';
import { handleGuestChat } from './guestChat';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountChatCompletionsRoutes(router: Hono<HonoEnv>): void {
  router.post('/v1/chat/completions', async (c) => {
    // Logged-out guest chat: a `bfguest_*` bearer routes to the isolated guest
    // handler BEFORE the tenant auth path ever runs (see handleGuestChat).
    if ((c.req.header('Authorization') ?? '').startsWith(`Bearer ${GUEST_TOKEN_PREFIX}`)) {
      return handleGuestChat(c);
    }

    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Loose on purpose: every SDK field (tools, response_format, temperature, vendor
    // extras…) rides through to the vendor untouched — see llmRoutes.schemas.ts.
    const parsed = await parseGatewayBody(c, ChatCompletionBody);
    if (parsed instanceof RequestValidationError) {
      return c.json(gatewayRefusalBody(parsed, 'messages array is required', 'messages'), 400);
    }
    if (!parsed.messages || parsed.messages.length === 0) {
      return c.json({ error: 'messages array is required' }, 400);
    }
    const body: ChatCompletionRequest = { ...parsed, messages: parsed.messages };

    // ── Client reasoning intent (VS Code chat "Thinking" toggle) ───────────
    // OPTIONAL vendor-neutral `reasoning: { level: 'low'|'medium'|'high' }`, omitted
    // entirely when the toggle is off (so today's requests stay byte-identical).
    // Validate + CANONICALIZE here, at the trust boundary: only the matched level
    // survives, so no arbitrary client-shaped `reasoning` object travels further, and a
    // garbage value degrades to today's behaviour instead of erroring. The actual
    // model-family mapping happens in the proxy's dispatch(), against the model the
    // cascade RESOLVES rather than the id the client asked for.
    //
    // Cost: extended thinking bills as output tokens, so it is already bounded by the
    // per-tenant daily + monthly gates in `enforceTokenCaps` below. NOTE: the anthropic
    // vendor raises max_tokens to fit an enabled thinking budget, so a thinking turn can
    // exceed the plan's max_tokens clamp applied below — a plan-tier gate on
    // `level: 'high'` is the natural hook if that ceiling ever needs to be hard.
    const reasoningIntent = parseClientReasoningIntent((body as Record<string, unknown>).reasoning);
    if (reasoningIntent) (body as Record<string, unknown>).reasoning = { level: reasoningIntent.thinkLevel };
    else delete (body as Record<string, unknown>).reasoning;

    // ── Model-ref expansion (project Evermind / tenant model / workforce) ──
    const bodyAny = body as Record<string, unknown>;
    await expandGatewayModelRefs(c.env, () => requestDb(c), access.tenantId, bodyAny);

    // Capture SDK transport metadata for usage logging — the body's `metadata`
    // and `useCase` are consumed here and stripped before vendor dispatch
    // (see STANDARD_BODY_FIELDS).
    const callerMetadata = (bodyAny.metadata as Record<string, unknown> | undefined) ?? null;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    // Ticket/project attribution for this row — header first, then `metadata`, each
    // validated against THIS tenant (see `usageWorkHints`). Without it every gateway
    // and image row lands with a NULL ticket and vanishes from the cost rollups.
    const workHints = await resolveWorkHints(c, access, callerMetadata);
    // The ONE key grammar (`application/shared/idempotentReplay.ts`) — the same the
    // `idempotentReplay` middleware enforces on the outbox-replayed writes.
    const parsedIdempotencyKey = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
    if (parsedIdempotencyKey === 'invalid') {
      return c.json({ error: `${IDEMPOTENCY_KEY_HEADER} must be 1-128 visible ASCII characters`, code: 'idempotency_key_invalid' }, 400);
    }
    const idempotencyKey = parsedIdempotencyKey;
    // This handler cannot sit behind the middleware (a streamed answer is not storable,
    // and an un-replayable retry must still meet the usage-log 409 guard below), so it
    // uses the middleware's store PORT and policy directly — one implementation.
    const idempotencyStore = createCacheIdempotencyStore(c.env);
    const idempotencyFingerprint = requestFingerprint(c.req.method, c.req.path);

    // Resolve the tenant's Claude subscription token AND BYO api-keys up front (one
    // round-trip) — needed both for the strict-pin gate below and for the proxy.
    // The subscription powers direct-Claude; the BYO keys override the operator
    // keys for their vendors so the tenant's own account serves the call ($0 to us,
    // metered byo). The connected vendors also unlock free-plan model choice.
    const tenantCreds = await resolveTenantLlmCredentials(c.env, access.tenantId);
    const { anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, vendorKeys: tenantVendorKeys } = tenantCreds;
    // DISPATCH vendor ids — a connected subscription rides `openai-codex` / `xai-oauth`.
    const byoVendors = byoVendorIdsFromCredentials(tenantCreds);

    const strictRefusal = gateStrictPin(c, access, body, byoVendors);
    if (strictRefusal) return strictRefusal;
    const premiumGate = await gatePremiumSelection(c, access, body, byoVendors);
    if ('blocked' in premiumGate) return premiumGate.blocked;
    const { premiumSelected, pinnedModel } = premiumGate;

    // ── Token usage + limit checks (daily + monthly) ────────────────────────
    // Shared cache-discounted gate (per tenant) — also enforced on /v1/messages'
    // our-models branch. Returns the 429 to send, or the usage numbers reused
    // below for the X-Builderforce-*-Tokens-* headers.
    const capResult = await enforceTokenCaps(c, access);
    if ('blocked' in capResult) return capResult.blocked;

    if (idempotencyKey) {
      const replayed = await replayIdempotentRequest(c, access.tenantId, idempotencyKey, idempotencyStore, idempotencyFingerprint);
      if (replayed) return replayed;
    }

    const llmProduct = productNameForPlan(access.effectivePlan, access.premiumOverride);
    // Premium override forces the Pro OpenRouter key path; otherwise plan-driven.
    const isPro = access.premiumOverride || access.effectivePlan !== 'free';

    // ── Output cap ───────────────────────────────────────────────────────────
    // Clamp max_tokens to the plan ceiling so a misconfigured client can't ask
    // for a giant generation and bill a full 128K-token output in one shot.
    // Clamp down rather than reject (the request still succeeds, just bounded).
    // Superadmins and unlimited daily-limit overrides (-1) bypass.
    const maxTokensCeiling = getLimits(toTenantPlan(access.effectivePlan)).maxTokensPerRequest;
    const maxTokensExempt = access.isSuperadmin || access.tokenDailyLimitOverride === -1;
    if (!maxTokensExempt && maxTokensCeiling > 0
        && typeof body.max_tokens === 'number' && body.max_tokens > maxTokensCeiling) {
      body.max_tokens = maxTokensCeiling;
    }

    // Validate required key for the active plan up-front so callers get a clear 503.
    const requiredKey = isPro ? c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY : c.env.OPENROUTER_API_KEY;
    if (!requiredKey && !tenantCanSelfFund(tenantCreds)) {
      return c.json({
        error: isPro
          ? 'LLM proxy not configured (missing OPENROUTER_API_KEY_PRO or OPENROUTER_API_KEY)'
          : 'LLM proxy not configured (missing OPENROUTER_API_KEY)',
      }, 503);
    }

    const traceId = newTraceId();
    const consumerRequestId = c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? null;
    const requestIp = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
    const reqOrigin = c.req.header('Origin') ?? null;
    const reqUserAgent = c.req.header('User-Agent') ?? null;

    // Close the funded overflow path once the tenant has hit its daily overflow
    // $ cap — the primary pool still runs, only the paid fallback/backstop is
    // disabled. Hard ceiling on what a tight retry loop can spend on our keys.
    const disablePaidOverflow = await isPaidOverflowExhausted(c.env, access);
    // Local egress for a vendor whose upstream refuses OUR machine rather than our
    // key (Kimi Code). Resolved once per request; null when this tenant has no
    // runtime connected, in which case those vendors call out directly as before.
    const hostEgress = await buildHostEgress(c.env, access.tenantId);
    const routingMode = bodyAny.routingMode === 'auto' || bodyAny.routingMode === 'byo_pool'
      ? bodyAny.routingMode
      : undefined;
    if (bodyAny.routingMode != null && routingMode == null) delete bodyAny.routingMode;
    // What kind of call this is, for the usage row — validated so a client can never write
    // an arbitrary string into the ledger. The proxy reads the same field to order the seed.
    const bodyRole = isModelRole(bodyAny.role) ? bodyAny.role : null;
    // What each model has actually delivered in THIS role (finest scope with evidence).
    // Orders the tenant's connected accounts AND the plan pool, so it is read with or
    // without a connected provider — but only for a role the system chooses for:
    // `roleRoutingStats` returns nothing for analysis and chat, which keep the tenant's
    // order. Cached blob reads.
    const roleStats = bodyRole
      ? await roleRoutingStats(c.env, requestDb(c), {
          tenantId: access.tenantId,
          projectId: workHints.projectId ?? null,
          role: bodyRole,
          ...(isArcStage(bodyAny.arcStage) ? { arcStage: bodyAny.arcStage } : {}),
        })
      : undefined;
    // Single routing path for every modality (chat + messages, VS Code Brain +
    // on-prem + SDK): an agentic tool-loop turn floors onto the paid coder backstop,
    // a plain chat keeps the general pool. Reuses the credentials resolved above so
    // any direct-Claude resolution rides the tenant subscription and BYO vendors
    // serve from the tenant's own account.
    const service = proxyForCompletion(c.env, access, body, { disablePaidOverflow, anthropicOAuthToken, openaiCodexAuth, xaiOAuthToken, tenantVendorKeys, hostEgress, byoRouting: byoRoutingOptions(tenantCreds),byoRequired: routingMode === 'byo_pool' || (routingMode == null && tenantCreds.configuredProviders.length > 0), allowGatewayAuto: routingMode === 'auto', byoDiagnostics: { configuredProviders: tenantCreds.configuredProviders, unresolvedReasons: tenantCreds.unresolvedReasons as Record<string, string> } });
    // Context-fit seeding: estimate the turn's tokens so the proxy drops
    // small-window models from the first-pass seed. This is the preventive half
    // of the Brain "dies after several executions" fix — the reactive 413
    // failover still backstops, but a long transcript no longer gets SEEDED onto
    // a model it would immediately overflow.
    const estimatedTokens = estimateRequestTokens(body.messages, (body as { tools?: unknown }).tools);
    // A cost-first call (explore / utility / verify) orders the pool by expected cost;
    // only that call pays for the (cached) price-book read.
    const prices = await pricesForCall(c.env, bodyRole, bodyAny.arcStage);
    const result = await service.complete(body, undefined, traceId, undefined, {
      estimatedTokens,
      ...(roleStats ? { roleStats } : {}),
      ...(prices ? { prices } : {}),
    });

    // Did the PREMIUM model the tenant selected actually serve this turn? Only then
    // does the flat 1¢ surcharge apply — if the cascade failed over to a plan-pool
    // model, the tenant gets plan pricing and no surcharge (they didn't get premium).
    const premiumServed = premiumSelected && result.resolvedModel === pinnedModel;
    const platformSurcharge = premiumServed || result.platformSurcharge === true;

    const upstreamHeaders = await buildCompletionHeaders(c, {
      access, result, traceId, llmProduct, premiumServed, byoVendors, tenantCreds,
      body: body as { tools?: unknown }, caps: capResult,
    });

    const recordBrainChatModelActivity = (): void => {
      const promise = recordGatewayChatModelActivity(c.env, () => requestDb(c), {
        tenantId: access.tenantId,
        callerMetadata,
        resolvedModel: result.resolvedModel,
        resolvedVendor: result.resolvedVendor,
        byoFunded: result.byoFunded ?? false,
        hasConnectedByo: byoVendors.size > 0,
      });
      if (promise) c.executionCtx?.waitUntil?.(promise);
    };

    // The fields every usage row of this turn shares, streamed or not.
    const usageRow = {
      tenantId: access.tenantId, userId: access.userId, llmProduct,
      model: result.resolvedModel, retries: result.retries,
      metadata: callerMetadata, idempotencyKey, useCase: callerUseCase,
      tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId, ...workHints, role: bodyRole }, traceId,
      paidOverflow: result.paidOverflow,
      byo: result.byoFunded ?? false,
      byoProvider: result.byoFunded ? normalizeByoProvider(result.resolvedVendor) : null,
      premiumSurcharge: platformSurcharge,
      premium: premiumServed,
    };
    const traceBase = {
      traceId, surface: 'chat' as const,
      tenantId: access.tenantId, userId: access.userId, agentHostId: access.agentHostId,
      tenantApiKeyId: access.tenantApiKeyId, llmProduct,
      effectivePlan: access.effectivePlan, premiumOverride: access.premiumOverride,
      result, useCase: callerUseCase, idempotencyKey,
      consumerRequestId, requestIp, origin: reqOrigin, userAgent: reqUserAgent,
      requestBody: body as unknown as Record<string, unknown>, callerMetadata,
    };

    const logCascadeFailovers = (): void => {
      logFailovers(c.env, c.executionCtx, result.failovers, { tenantId: access.tenantId, requestId: traceId });
      logProviderAuthAlerts(c.env, c.executionCtx, access.tenantId, result.failovers);
    };

    // ── Streaming ────────────────────────────────────────────────────────────
    if (body.stream && result.response.body) {
      upstreamHeaders.set('cache-control', 'no-cache');
      upstreamHeaders.set('connection', 'keep-alive');

      // Log any failovers that happened before this successful model
      logCascadeFailovers();

      // Full diagnostic trace (builder-side only). For streams the completion
      // body isn't captured here; identity, timing, attempts, and the chain are.
      logTrace(c.env, c.executionCtx, { ...traceBase, streamed: true, responseBody: null, errorMessage: null });

      // Tee the stream so the trace row gets BOTH halves it can only learn in
      // passing: the token counts from the final usage frame, and the completion
      // body reassembled from the deltas (`response_body` was null on every
      // streamed trace until this tee existed).
      const instrumentedStream = wrapStreamForTrace(result.response.body, {
        onUsage: (usage) => {
          logUsage(c.env, c.executionCtx, { ...usageRow, streamed: true, usage, surface: resolveUsageSurface(c, access) });
          // Back-fill the streamed trace row (logged above with 0 tokens) [1298].
          backfillTraceUsage(c.env, c.executionCtx, traceId, usage);
          recordBrainChatModelActivity();
        },
        onComplete: (completion) => {
          backfillTraceResponseBody(c.env, c.executionCtx, traceId, {
            streamed: true,
            content: completion.content,
            finishReason: completion.finishReason,
            model: completion.model,
            ...(completion.toolCalls.length > 0 ? { toolCalls: completion.toolCalls } : {}),
          });
        },
      });

      return new Response(instrumentedStream, {
        status: result.response.status,
        headers: upstreamHeaders,
      });
    }

    // ── Non-streaming ────────────────────────────────────────────────────────
    const upstream = await result.response.json() as Record<string, unknown>;

    // Log any failovers, then log usage
    logCascadeFailovers();
    logUsage(c.env, c.executionCtx, {
      ...usageRow,
      streamed: false,
      usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      surface: resolveUsageSurface(c, access),
    });
    recordBrainChatModelActivity();

    const traceErrorMessage = stampTraceIdOnError(upstream, traceId);

    // Full diagnostic trace (builder-side only).
    logTrace(c.env, c.executionCtx, {
      ...traceBase, streamed: false, usage: result.usage ?? null,
      responseBody: upstream, errorMessage: traceErrorMessage,
    });

    const responseEnvelope = buildCompletionEnvelope(c, {
      upstream, access, result, traceId, llmProduct, platformSurcharge,
      callerUseCase, callerMetadata, caps: capResult,
    });
    const responseStatus = result.response.status as 200;
    // Cache the successful body so a retry with the same Idempotency-Key REPLAYS
    // it (200) rather than getting a 409 [1232] — transparent cron retries.
    // Non-streaming 2xx only, through the shared idempotency store (TTL
    // `IDEMPOTENCY_TTL_SECONDS`). Fire-and-forget — never delays the response;
    // store-absent → the 409 guard.
    if (idempotencyKey && isStorableStatus(responseStatus)) {
      c.executionCtx.waitUntil(
        idempotencyStore.put(access.tenantId, idempotencyKey, {
          fingerprint: idempotencyFingerprint,
          status: responseStatus,
          body: JSON.stringify(responseEnvelope),
          contentType: 'application/json',
        }).catch((error) => { /* cache write is best-effort */
          reportCaughtError(error, { source: 'presentation/routes/llm/chatCompletionsRoutes.ts', operation: 'idempotencyStorePut' });
        }),
      );
    }
    return c.json(responseEnvelope, responseStatus);
  });
}
