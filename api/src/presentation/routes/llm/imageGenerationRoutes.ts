/**
 * POST /v1/images/generations — OpenAI-compatible image generation.
 * Cascades the free vendors (Cloudflare / Together / Hugging Face / Pollinations,
 * interleaved) → paid Gemini / FluxAPI → premium FluxAPI fallback, gated by its own
 * daily image-credit budget (migration 0131).
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { RequestValidationError } from '../../../domain/shared/errors';
import { ImageGenerationBody, gatewayRefusalBody, parseGatewayBody } from '../llmRoutes.schemas';
import { newTraceId } from '../../../application/llm/LlmProxyService';
import {
  anyImageVendorBound,
  imageProxyForPlan,
  imageProductNameForPlan,
  NO_IMAGE_VENDOR_MESSAGE,
  type ImageGenerationRequest,
} from '../../../application/llm/ImageProxyService';
import { persistGeneratedImages } from '../../../application/llm/persistGeneratedImages';
import { IMAGE_TOKEN_COST } from '../../../application/llm/mediaProducts';
import { logTrace, imageTraceResult } from '../../../application/llm/traceLogger';
import { isPaidOverflowExhausted, logFailovers, logUsage } from '../../../application/llm/gatewayUsageLog';
import { enforceMediaCreditCap } from '../mediaCreditGate';
import { IMAGE_CREDIT_POLICY, resolveCallerAttribution, resolveUsageSurface } from './gatewayGuards';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountImageGenerationRoutes(router: Hono<HonoEnv>): void {
  router.post('/v1/images/generations', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Loose: the whole body is handed to the image proxy (size, n, response_format, extras…).
    const parsed = await parseGatewayBody(c, ImageGenerationBody);
    if (parsed instanceof RequestValidationError) {
      return c.json(gatewayRefusalBody(parsed, '`prompt` is required and must be a non-empty string', 'prompt'), 400);
    }
    if (parsed.prompt.trim().length === 0) {
      return c.json({ error: '`prompt` is required and must be a non-empty string' }, 400);
    }
    const body: ImageGenerationRequest = parsed;

    // Validate that at least one image vendor key is bound before dispatching —
    // derived from the vendor registry so it never lags a newly added vendor.
    if (!anyImageVendorBound(c.env)) {
      return c.json({ error: NO_IMAGE_VENDOR_MESSAGE }, 503);
    }

    // Independent image-credit budget (migration 0131) — gate BEFORE dispatch so
    // an over-budget tenant doesn't incur a vendor call. Separate from the chat
    // token cap.
    const imageCapBlocked = await enforceMediaCreditCap(c, access, IMAGE_CREDIT_POLICY);
    if (imageCapBlocked) return imageCapBlocked;

    // Capture SDK transport metadata for usage logging — stripped before vendor dispatch
    // by `stripStandardFields` in ImageProxyService.
    const bodyAny = body as Record<string, unknown>;
    const callerUseCase  = typeof bodyAny.useCase === 'string' ? bodyAny.useCase : null;
    // Ticket/project attribution for this row — header first, then `metadata`, each
    // validated against THIS tenant (see `usageWorkHints`). Without it every gateway
    // and image row lands with a NULL ticket and vanishes from the cost rollups.
    // Chat attribution too: a chat id that is not this tenant's is dropped (PRD 36, D2).
    const { workHints, callerMetadata } = await resolveCallerAttribution(c, access, bodyAny);
    const idempotencyKey = c.req.header('Idempotency-Key') ?? null;

    const productName = imageProductNameForPlan(access.effectivePlan, access.premiumOverride);
    // Same per-tenant funded-overflow ceiling as the chat path (migration 0130):
    // once a tenant exhausts its daily paid-overflow cap, drop the always-on
    // premium FluxAPI fallback so the free pool still serves but our funded key
    // stops. Reuses the shared `isPaidOverflowExhausted` gate.
    const disablePaidOverflow = await isPaidOverflowExhausted(c.env, access);
    const service = imageProxyForPlan(c.env, access.effectivePlan, access.premiumOverride, { disablePaidOverflow });
    // Images get the same authoritative trace id chat does, so a consumer can quote
    // ONE id for either surface and a superadmin can look it up the same way.
    const traceId = newTraceId();
    const imageStartedAt = Date.now();
    const result = await service.generate(body);
    const imageDurationMs = Date.now() - imageStartedAt;

    // Image accounting: still charge a flat per-image token estimate onto the
    // usage row (retained for cost rollups), but image generation is now gated by
    // its OWN daily credit budget (the media credit gate above), NOT the chat
    // token cap — the two budgets are independent (migration 0131). IMAGE_TOKEN_COST
    // is shared with the credit-count query so charge and count agree.
    const imagesReturned = Math.max(result.body.data.length, 0);
    const billedTokens = imagesReturned > 0 ? imagesReturned * IMAGE_TOKEN_COST : 0;
    const cascadeExhausted = result.body.data.length === 0;

    // Log usage (always, even on cascade-exhausted runs so failure rates are visible).
    logFailovers(c.env, c.executionCtx, result.failovers, { tenantId: access.tenantId });
    logUsage(c.env, c.executionCtx, {
      tenantId: access.tenantId, userId: access.userId, llmProduct: productName,
      model: result.resolvedModel, retries: result.retries, streamed: false,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: billedTokens },
      metadata: callerMetadata, idempotencyKey, useCase: callerUseCase,
      tenantApiKeyId: access.tenantApiKeyId, attribution: { agentHostId: access.agentHostId, ...workHints },
      paidOverflow: result.paidOverflow,
      // No `byo`: image generation has no tenant-credential path (imageProxyForPlan
      // never takes tenant vendor keys), so every image row is platform-funded.
      surface: resolveUsageSurface(c, access),
    });

    // Full diagnostic trace. `ImageProxyService` returns an `ImageProxyResult`, not
    // a `ProxyResult`, so it reaches the ONE trace writer through the shared
    // `imageTraceResult` adapter rather than a second copy of the row builder.
    const imageError = (result.body as unknown as { _builderforceError?: { message?: string } })._builderforceError;
    logTrace(c.env, c.executionCtx, {
      traceId, surface: 'image',
      tenantId: access.tenantId, userId: access.userId, agentHostId: access.agentHostId,
      tenantApiKeyId: access.tenantApiKeyId, llmProduct: productName,
      effectivePlan: access.effectivePlan, premiumOverride: access.premiumOverride,
      result: imageTraceResult(result, { durationMs: imageDurationMs }),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: billedTokens },
      streamed: false, useCase: callerUseCase, idempotencyKey,
      consumerRequestId: c.req.header('x-request-id') ?? c.req.header('x-correlation-id') ?? null,
      requestIp: c.req.header('cf-connecting-ip') ?? null,
      origin: c.req.header('Origin') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      requestBody: body as unknown as Record<string, unknown>,
      callerMetadata,
      // The image DATA urls/base64 are deliberately NOT stored: they are megabytes
      // of payload with no diagnostic value. What a trace is opened for is which
      // model served, how many images came back, and why a run returned none.
      responseBody: {
        created: result.body.created,
        model: result.body.model,
        images: imagesReturned,
        ...(result.failovers.length > 0 ? { failovers: result.failovers } : {}),
      },
      errorMessage: imageError?.message ?? null,
    });

    if (cascadeExhausted) {
      // All vendors failed — surface a 429 with the failover breakdown so callers
      // can decide whether to retry on a different prompt.
      return c.json({
        error: {
          message: 'Image vendor cascade exhausted. Retry shortly or simplify the prompt.',
          code: 429,
          type: 'rate_limit_error',
          details: { failovers: result.failovers, correlationId: traceId, traceId },
        },
      }, 429);
    }

    // Byte-producing vendors come back as `data:` URLs; store them once in the
    // tenant asset pipeline so the caller gets a compact, durable link.
    const data = await persistGeneratedImages({
      bucket: c.env.UPLOADS,
      entries: result.body.data,
      actor: { tenantId: access.tenantId, userId: access.userId ?? `agent-host-${access.agentHostId ?? 'gateway'}` },
      publicOrigin: new URL(c.req.url).origin,
    });

    return c.json({
      created: result.body.created,
      data,
      model: result.body.model,
      _builderforce: {
        traceId,
        resolvedModel: result.resolvedModel,
        resolvedVendor: result.resolvedVendor,
        retries: result.retries,
        ...(result.failovers.length > 0 ? { failovers: result.failovers } : {}),
        product: productName,
        effectivePlan: access.effectivePlan,
        ...(access.premiumOverride ? { premium: true } : {}),
        ...(callerUseCase  ? { useCase:  callerUseCase  } : {}),
        ...(callerMetadata ? { metadata: callerMetadata as Record<string, string> } : {}),
        ...(c.req.header('x-request-id') ? { requestId: c.req.header('x-request-id') } : {}),
      },
    });
  });
}
