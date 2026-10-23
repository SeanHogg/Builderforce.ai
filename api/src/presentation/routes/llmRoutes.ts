/**
 * builderforceLLM routes — the OpenAI-compatible LLM gateway, mounted at `/llm`.
 *
 * This module is the COMPOSER: each sub-resource lives in its own module under
 * `./llm/`, and the gateway auth every one of them (and several other route modules
 * and middleware) shares is re-exported from here so no importer changed.
 *
 *   ./llm/providerKeyRoutes          /provider-keys/*, /byo-precedence (+ OAuth, selected models)
 *   ./llm/openRouterConnectionRoutes /openrouter-connections/*
 *   ./llm/messagesRoutes             POST /v1/responses, POST /v1/messages
 *   ./llm/embedSessionRoutes         POST /v1/embed-session
 *   ./llm/mcpGatewayRoutes           /v1/mcp/tools, /v1/mcp/surfaces, /v1/mcp/call
 *   ./llm/skillLibraryRoutes         /v1/skills, /v1/skills/:name/package
 *   ./llm/chatCompletionsRoutes      POST /v1/chat/completions (multi-vendor cascade)
 *   ./llm/modelsRoutes               GET /v1/catalog, /v1/models, /v1/health
 *   ./llm/learnedRoutingRoutes       /v1/model-analytics, /v1/recall-seed, /v1/run-outcome
 *   ./llm/usageRoutes                GET /v1/usage, /v1/builder-insights(/stream)
 *   ./llm/embeddingsRoutes           POST /v1/embeddings
 *   ./llm/imageGenerationRoutes      POST /v1/images/generations
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { mountProviderKeyRoutes } from './llm/providerKeyRoutes';
import { mountOpenRouterConnectionRoutes } from './llm/openRouterConnectionRoutes';
import { mountMessagesRoutes } from './llm/messagesRoutes';
import { mountEmbedSessionRoutes } from './llm/embedSessionRoutes';
import { mountMcpGatewayRoutes } from './llm/mcpGatewayRoutes';
import { mountSkillLibraryRoutes } from './llm/skillLibraryRoutes';
import { mountChatCompletionsRoutes } from './llm/chatCompletionsRoutes';
import { mountModelsRoutes } from './llm/modelsRoutes';
import { mountLearnedRoutingRoutes } from './llm/learnedRoutingRoutes';
import { mountUsageRoutes } from './llm/usageRoutes';
import { mountEmbeddingsRoutes } from './llm/embeddingsRoutes';
import { mountImageGenerationRoutes } from './llm/imageGenerationRoutes';

export {
  requireTenantAccess,
  resolveBearerTenantId,
  respondToAccessError,
  TenantAccessError,
  type TenantAccess,
} from './llm/access';

export function createLlmRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  mountProviderKeyRoutes(router);
  mountOpenRouterConnectionRoutes(router);
  mountMessagesRoutes(router);
  mountEmbedSessionRoutes(router);
  mountMcpGatewayRoutes(router);
  mountSkillLibraryRoutes(router);
  mountChatCompletionsRoutes(router);
  mountModelsRoutes(router);
  mountLearnedRoutingRoutes(router);
  mountUsageRoutes(router);
  mountEmbeddingsRoutes(router);
  mountImageGenerationRoutes(router);
  return router;
}
