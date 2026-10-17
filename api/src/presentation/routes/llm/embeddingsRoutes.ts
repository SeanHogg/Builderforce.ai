/**
 * POST /v1/embeddings — OpenAI-compatible. OpenRouter first, Voyage / Cloudflare
 * Workers AI as failover, metered onto the tenant's token budget.
 */
import type { Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { statusResponse } from '../../middleware/errorResponse';
import { RequestValidationError } from '../../../domain/shared/errors';
import { EmbeddingsBody, gatewayRefusalBody, parseGatewayBody } from '../llmRoutes.schemas';
import { productNameForPlan } from '../../../application/llm/LlmProxyService';
import { dispatchEmbeddingVendor, EmbeddingCascadeExhaustedError } from '../../../application/llm/embeddingVendors';
import { VendorFatalError } from '../../../application/llm/vendors/types';
import { estimateTokensFromChars } from '../../../application/llm/tokenUsage';
import { logUsage } from '../../../application/llm/gatewayUsageLog';
import { enforceTokenCaps, resolveUsageSurface, resolveWorkHints } from './gatewayGuards';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountEmbeddingsRoutes(router: Hono<HonoEnv>): void {
  router.post('/v1/embeddings', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }

    // Per-plan OpenRouter key (primary vendor) + Voyage failover key. The
    // embeddings cascade tries OpenRouter first, then falls over to Voyage if
    // OpenRouter's endpoint is down — so a single-vendor outage no longer fails
    // every vector workflow. Both vendors are optional; the cascade skips any
    // vendor without a key, and only 503s if NEITHER is configured.
    const openRouterKey = access.effectivePlan === 'free'
      ? c.env.OPENROUTER_API_KEY
      : (c.env.OPENROUTER_API_KEY_PRO ?? c.env.OPENROUTER_API_KEY);
    if (!openRouterKey && !c.env.VOYAGE_API_KEY && !(c.env.CLOUDFLARE_AI_API_TOKEN && c.env.CLOUDFLARE_ACCOUNT_ID)) {
      return c.json({ error: 'Embeddings vendor not configured (missing OPENROUTER_API_KEY and VOYAGE_API_KEY)' }, 503);
    }

    // Loose: every key but model/input/metadata is forwarded to the embeddings vendor.
    const body = await parseGatewayBody(c, EmbeddingsBody);
    if (body instanceof RequestValidationError) {
      return c.json(gatewayRefusalBody(body, '`input` must be a string or array of strings', 'input'), 400);
    }
    // Embedding spend belongs to a ticket/project too — a RAG index rebuild is real
    // cost against real work. Validated against THIS tenant before it is written.
    const workHints = await resolveWorkHints(c, access, body.metadata);

    // Plan/daily/monthly token cap — gate BEFORE the funded vendor call so a
    // cap-exhausted (or per-agentHost-limited) tenant can't loop the operator's
    // OpenRouter/Voyage key for free. Same shared gate the chat/messages handlers
    // use; returns a 429 Response when blocked.
    const capResult = await enforceTokenCaps(c, access);
    if ('blocked' in capResult) return capResult.blocked;

    // Strip gateway-only fields before forwarding to the vendor.
    const { metadata, model, input, ...extraBody } = body;
    const envelope = (raw: Record<string, unknown>) => ({
      ...raw,
      _builderforce: {
        product: productNameForPlan(access.effectivePlan, access.premiumOverride),
        effectivePlan: access.effectivePlan,
        ...(access.premiumOverride ? { premium: true } : {}),
      },
    });

    try {
      const result = await dispatchEmbeddingVendor({
        env: { OPENROUTER_API_KEY: openRouterKey, VOYAGE_API_KEY: c.env.VOYAGE_API_KEY, CLOUDFLARE_AI_API_TOKEN: c.env.CLOUDFLARE_AI_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: c.env.CLOUDFLARE_ACCOUNT_ID },
        model,
        input,
        extraBody,
      });
      // Forward the upstream's untouched OpenAI-shaped body so caller-side
      // fields survive; annotate which vendor actually resolved for diagnostics.
      const out: Record<string, unknown> = result.raw && typeof result.raw === 'object'
        ? { ...(result.raw as Record<string, unknown>) }
        : { object: result.object, data: result.data, model: result.model, ...(result.usage ? { usage: result.usage } : {}) };
      out._vendor = result.vendorUsed;

      // Meter the funded embeddings call so it counts on the token budget and
      // lands in llm_usage_log (was silently free — a cap-exhausted tenant could
      // loop it invisibly). Prefer the vendor-reported token usage; when the
      // vendor omits it, fall back to the shared ~4-char/token estimate and mark
      // the row `tokensEstimated` so it's distinguishable from a metered count.
      const inputChars = Array.isArray(input)
        ? input.reduce((n, s) => n + (typeof s === 'string' ? s.length : 0), 0)
        : (typeof input === 'string' ? input.length : 0);
      const vendorPrompt = result.usage?.prompt_tokens;
      const vendorTotal = result.usage?.total_tokens;
      const tokensEstimated = vendorPrompt == null && vendorTotal == null;
      const promptTokens = vendorPrompt ?? estimateTokensFromChars(inputChars);
      const totalTokens = vendorTotal ?? promptTokens;
      logUsage(c.env, c.executionCtx, {
        tenantId: access.tenantId, userId: access.userId,
        llmProduct: productNameForPlan(access.effectivePlan, access.premiumOverride),
        model: result.model, streamed: false,
        // Embeddings have no completion tokens.
        usage: { promptTokens, completionTokens: 0, totalTokens },
        useCase: 'embedding',
        metadata: { vendor: result.vendorUsed, ...(tokensEstimated ? { tokensEstimated: true } : {}) },
        tenantApiKeyId: access.tenantApiKeyId,
        attribution: { agentHostId: access.agentHostId, ...workHints },
        // Funded (operator key) — byo defaults false, so the row is always billable.
        surface: resolveUsageSurface(c, access),
      });

      return c.json(envelope(out), 200);
    } catch (err) {
      // 400 bad payload — failover won't help, surface as-is.
      if (err instanceof VendorFatalError) {
        return statusResponse(c, envelope({ error: err.message }), err.status, { source: 'presentation/routes/llm/embeddingsRoutes.ts', operation: 'vendorFatal' }, err);
      }
      // Every vendor failed (outage on all configured providers).
      if (err instanceof EmbeddingCascadeExhaustedError) {
        return c.json(envelope({ error: err.message, attempts: err.attempts }), 502);
      }
      throw err;
    }
  });
}
