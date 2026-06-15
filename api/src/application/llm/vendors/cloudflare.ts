/**
 * Cloudflare Workers AI vendor module.
 *
 * Cloudflare hosts a catalog of `@cf/<owner>/<model>` checkpoints behind the
 * native `POST /accounts/<id>/ai/run/<model>` endpoint. The URL embeds the
 * model, which differs from the OpenAI-compatible vendors — so this module
 * builds the endpoint per call instead of using a fixed `ENDPOINT` const.
 *
 * Bindings:
 *   CLOUDFLARE_AI_API_TOKEN — `cfut_*` token sent as `Authorization: Bearer`.
 *   CLOUDFLARE_ACCOUNT_ID   — embedded in the URL (`/accounts/<id>/ai/run/...`).
 *
 * Both must be present for `apiKeyFrom` to return a non-null value; otherwise
 * the dispatcher skips Cloudflare with `skippedNoKey` exactly as it does any
 * other unbound vendor. Tiering is STANDARD by default (cheap, small models);
 * upgrade specific catalog entries to PREMIUM if you onboard a larger model.
 */

import {
  fetchWithVendorTimeout,
  VendorRetryableError,
  VendorFatalError,
  pickUsage,
  CASCADE_STATUSES,
  AUTH_STATUSES,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorEnv,
  type VendorModelEntry,
  type VendorModule,
} from './types';

// Tier note: these are paid Workers AI checkpoints joining the PRO paid pool
// (autoRoutableModelsByTier pulls STANDARD/PREMIUM/ULTRA). `qwen3-30b-a3b` is a
// capable agentic coder and IS tool-capable — the request/response tool translation
// below (OpenAI tools → Cloudflare `tools`, Cloudflare `result.tool_calls` → OpenAI
// `tool_calls`) lets it drive the multi-turn coding loop, so it also sits in
// CODING_MODEL_POOL. `gemma-4-26b` is a general chat model (no `tools` capability).
const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: '@cf/meta/llama-3-8b-instruct', tier: 'STANDARD', label: 'Llama 3 8B (Cloudflare)',       brand: 'Meta' },
  { id: '@cf/google/gemma-4-26b-a4b-it', tier: 'STANDARD', label: 'Gemma 4 26B A4B (Cloudflare)', brand: 'Google' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8',    tier: 'STANDARD', label: 'Qwen3 30B A3B (Cloudflare)',   brand: 'Qwen', capabilities: ['tools', 'structured_output'] },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForCloudflareModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'STANDARD';
}

/**
 * Build the per-call endpoint URL. Cloudflare's native API embeds the model id
 * after `/ai/run/`. The model id starts with `@cf/...` which is URL-safe as-is
 * (RFC 3986 allows `@` in the path component).
 */
function endpointFor(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}

/**
 * Translate OpenAI tool definitions to Cloudflare's native `/ai/run` shape. OpenAI
 * sends `[{type:'function', function:{name, description, parameters}}]`; Cloudflare's
 * embedded function-calling wants the flat `[{name, description, parameters}]`.
 * Returns `[]` when nothing translatable so the caller omits `tools` entirely.
 */
function toCloudflareTools(openaiTools: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const t of openaiTools) {
    const tool = t as { function?: { name?: string; description?: string; parameters?: unknown }; name?: string; description?: string; parameters?: unknown; input_schema?: unknown } | null;
    const fn = tool?.function;
    const name = fn?.name ?? tool?.name;
    if (!name) continue;
    out.push({
      name,
      description: fn?.description ?? tool?.description ?? '',
      parameters: fn?.parameters ?? tool?.parameters ?? tool?.input_schema ?? { type: 'object', properties: {} },
    });
  }
  return out;
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  const { messages, maxTokens, temperature, topP, extraBody } = params;
  // Pull OpenAI `tools`/`tool_choice` out of the passthrough so they don't reach
  // Cloudflare in the wrong shape; re-add `tools` translated to the native shape.
  // Cloudflare's native /ai/run has no `tool_choice`, so it's dropped.
  const extra = { ...(extraBody ?? {}) } as Record<string, unknown>;
  const openaiTools = Array.isArray(extra.tools) ? (extra.tools as unknown[]) : undefined;
  delete extra.tools;
  delete extra.tool_choice;
  const cfTools = openaiTools ? toCloudflareTools(openaiTools) : [];
  return {
    messages,
    ...(maxTokens   != null ? { max_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP        != null ? { top_p: topP } : {}),
    ...extra,
    ...(cfTools.length > 0 ? { tools: cfTools } : {}),
  };
}

/**
 * Cloudflare's native /ai/run response shape:
 *   { result: { response: "...", tool_calls?: [{name, arguments}], usage?: {...} }, success: true, ... }
 *
 * Map to OpenAI-style `{ choices: [{ message: { content, tool_calls } }], usage }`
 * so the downstream `_builderforce.resolvedModel` + restore-tool-names path AND the
 * cloud coding loop's `parseLlmChoice` (which reads `choices[0].message.tool_calls`)
 * work uniformly. Cloudflare returns tool calls flat (`{name, arguments}`, no id, and
 * `arguments` may be an object), so we synthesize an id and JSON-stringify the args to
 * match the OpenAI `tool_calls` shape every other vendor emits.
 */
function adaptCloudflareResponse(raw: unknown): {
  raw: unknown;
  content: string;
  usage?: ReturnType<typeof pickUsage>;
} {
  const r = raw as {
    result?:  { response?: unknown; tool_calls?: unknown; usage?: unknown };
    success?: boolean;
    errors?:  unknown;
  } | null;
  const response = r?.result?.response;
  const content  = typeof response === 'string' ? response : '';
  const usage    = pickUsage(r?.result?.usage);

  const rawToolCalls = Array.isArray(r?.result?.tool_calls) ? r!.result!.tool_calls : [];
  const toolCalls = rawToolCalls.map((tcRaw, i) => {
    const tc = tcRaw as { name?: string; arguments?: unknown };
    const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {});
    return { id: `cf-${i}-${crypto.randomUUID()}`, type: 'function' as const, function: { name: tc.name ?? '', arguments: args } };
  });

  // Tool-call-only turns legitimately have no text — null content + tool_calls (matches
  // OpenAI). `isEmptyChatResponse` treats a populated tool_calls array as non-empty.
  const message: Record<string, unknown> = { role: 'assistant', content: content || (toolCalls.length ? null : '') };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const adapted = {
    choices: [{ index: 0, message, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }],
    usage,
  };
  return { raw: adapted, content, ...(Object.keys(usage).length > 0 ? { usage } : {}) };
}

export const cloudflareModule: VendorModule = {
  id: 'cloudflare',
  catalog: CATALOG,
  tierFor: tierForCloudflareModel,
  apiKeyFrom(env: VendorEnv): string | null {
    // Both must be present — the URL needs the account id, the header needs
    // the token. Composing into a single sentinel string keeps the registry's
    // `apiKeyFrom` contract (string | null) unchanged; we split it back inside
    // `call` below. Format: `<token>::<accountId>`.
    const token     = env.CLOUDFLARE_AI_API_TOKEN ?? null;
    const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? null;
    if (!token || !accountId) return null;
    return `${token}::${accountId}`;
  },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    const [token, accountId] = params.apiKey.split('::');
    if (!token || !accountId) {
      throw new VendorFatalError('cloudflare', 500, 'malformed cloudflare apiKey sentinel (expected "<token>::<accountId>")');
    }
    const endpoint = endpointFor(accountId, params.model);
    const body     = buildBody(params);

    const resp = await fetchWithVendorTimeout('cloudflare', params.model, endpoint, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Title':      params.title ?? 'Builderforce.ai',
      },
      body: JSON.stringify(body),
    }, params.timeoutMs, params.signal);

    if (resp.ok) {
      const raw = await resp.json();
      // Cloudflare returns `success: false` in the 200-body for some failures
      // (model not enabled, account quota, etc.) — convert to retryable so the
      // cascade advances and a cooldown is recorded.
      if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).success === false) {
        const errs = (raw as { errors?: unknown[] }).errors;
        const msg = Array.isArray(errs) && errs.length > 0 ? JSON.stringify(errs).slice(0, 240) : 'cloudflare success=false';
        throw new VendorRetryableError('cloudflare', params.model, 0, `embedded: ${msg}`);
      }
      return adaptCloudflareResponse(raw);
    }

    const errText = (await resp.text()).slice(0, 400);
    if (CASCADE_STATUSES.has(resp.status)) {
      throw new VendorRetryableError('cloudflare', params.model, resp.status, errText.slice(0, 240));
    }
    if (AUTH_STATUSES.has(resp.status)) {
      console.error(
        `[vendors] cloudflare/${params.model} auth ${resp.status} — check CLOUDFLARE_AI_API_TOKEN. Failing over to next model.`,
        errText.slice(0, 200),
      );
      throw new VendorRetryableError('cloudflare', params.model, resp.status, `auth ${resp.status}: ${errText.slice(0, 200)}`);
    }
    throw new VendorFatalError('cloudflare', resp.status, errText);
  },
  // No `callStream` — Cloudflare's `/ai/run/` endpoint doesn't expose SSE
  // streaming on every model. Skip streaming dispatch; `dispatchVendorStream`
  // will record `skippedNoStream` and walk past Cloudflare entries when the
  // caller asked for `stream: true`.
};
