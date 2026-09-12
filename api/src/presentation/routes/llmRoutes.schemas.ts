/**
 * Request-body schemas for `llmRoutes` — the OpenAI-/Anthropic-compatible gateway and
 * the provider-key settings surface beside it.
 *
 * ── THE GATEWAY BODIES ARE LOOSE ON PURPOSE ─────────────────────────────────
 * `/v1/chat/completions`, `/v1/embeddings`, `/v1/images/generations` and
 * `/v1/responses` receive bodies built by third-party SDKs and forward them to a
 * vendor: `tools`, `tool_choice`, `response_format`, `temperature`, provider
 * extras… `z.object` would silently STRIP every one of those, and typing a field
 * the gateway never reads would refuse requests it has always served. So each is
 * a `z.looseObject` that types ONLY what its handler reads, exactly as strictly as
 * the handler already required, and passes every other key through untouched.
 *
 * Those endpoints also keep their own bad-input answer (see {@link parseGatewayBody}),
 * so an SDK that branches on the error text it has always seen keeps seeing it.
 */
import { parseBody, z, zJsonObject, type BodyContext } from './requestBody';
import { RequestValidationError } from '../../domain/shared/errors';
import { errorResponseBody, type ErrorResponseBody } from '../middleware/errorResponse';
import type { ChatMessage } from '../../application/llm/LlmProxyService';

// ── Gateway (third-party SDK) bodies ─────────────────────────────────────────

/**
 * One chat message. It must be an object — the handler reads `.role` / `.content`
 * off every element — and is otherwise untouched: `content` may be a string OR an
 * array of parts, and `tool_calls`, `tool_call_id`, `name`, … all ride through to
 * the vendor. The proxy owns the per-field rules.
 */
const zChatMessage = z.custom<ChatMessage>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'each message must be an object',
);

/**
 * POST /v1/chat/completions (tenant AND guest doors). `messages` is optional so an
 * absent or empty list still answers the handler's own "messages array is required".
 * `model`, `stream`, `max_tokens`, `reasoning`, `metadata`… are all read through
 * `typeof` guards by the handler, so they pass through unvalidated, as before.
 */
export const ChatCompletionBody = z.looseObject({
  messages: z.array(zChatMessage).optional(),
});

/** POST /v1/embeddings — every key but `model`/`input`/`metadata` is forwarded to the vendor. */
export const EmbeddingsBody = z.looseObject({
  model: z.string().optional(),
  input: z.union([z.string(), z.array(z.string())]),
  metadata: z.unknown().optional(),
});

/** POST /v1/images/generations — the whole body is handed to the image proxy. */
export const ImageGenerationBody = z.looseObject({
  prompt: z.string(),
});

/** POST /v1/responses — forwarded verbatim to the Codex Responses backend; only an object is required. */
export const ResponsesBody = zJsonObject;

// ── Gateway-adjacent + settings bodies (app `{ error }` envelope) ────────────

/** POST /v1/run-outcome — the shared `parseRunOutcomeRequest` owns every field rule. */
export const RunOutcomeBody = zJsonObject;

/** POST /v1/mcp/call. Both ids are checked by hand ("extensionId and tool are required"). */
export const McpCallBody = z.object({
  extensionId: z.string().nullish(),
  tool: z.string().nullish(),
  arguments: z.unknown().optional(),
});

/** POST /openrouter-connections — every field is type-guarded by the handler. */
export const OpenRouterConnectionBody = z.object({
  label: z.unknown().optional(),
  models: z.unknown().optional(),
  apiKey: z.unknown().optional(),
});

/** PUT /openrouter-connections/:id. */
export const OpenRouterConnectionUpdateBody = OpenRouterConnectionBody.extend({
  clearKey: z.unknown().optional(),
});

/** PUT /provider-keys/priority — `order` is checked by hand ("order must be an array"). */
export const ByoPrecedenceBody = z.object({ order: z.unknown().optional() });

/** PUT /provider-keys/:provider. Each field is `?.trim()`med, so null reads as absent. */
export const ProviderKeyBody = z.object({
  apiKey: z.string().nullish(),
  baseUrl: z.string().nullish(),
  model: z.string().nullish(),
});

// ── Gateway refusals ─────────────────────────────────────────────────────────

/**
 * `parseBody` for a gateway endpoint that answers bad input in its OWN envelope:
 * a validation miss is RETURNED for the handler to render, never thrown to the
 * global handler. Any other failure still throws.
 */
export function parseGatewayBody<T>(c: BodyContext, schema: z.ZodType<T>): Promise<T | RequestValidationError> {
  return parseBody(c, schema).catch((error: unknown) => {
    if (error instanceof RequestValidationError) return error;
    throw error;
  });
}

/**
 * The `{ error, code, issues }` answer for a gateway validation miss. When every
 * issue sits at the root (not JSON / not an object) or on one of `fields`, the
 * handler's own `sentence` — the text that endpoint has always answered those
 * misses with — replaces the generic summary; anything else names its field.
 */
export function gatewayRefusalBody(error: RequestValidationError, sentence: string, ...fields: string[]): ErrorResponseBody {
  const { body } = errorResponseBody(error);
  const describedByHandler = error.issues.every((issue) => issue.path === '' || fields.includes(issue.path));
  return describedByHandler ? { ...body, error: sentence } : body;
}
