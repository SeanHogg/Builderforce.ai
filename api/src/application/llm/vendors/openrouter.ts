/**
 * OpenRouter vendor module.
 *
 * Catalog mirrors the historical FREE_MODEL_POOL + PRO_PAID_MODEL_POOL split
 * that LlmProxyService used to manage directly. Free-tier models drive the
 * Free plan; STANDARD/PREMIUM/ULTRA models extend the Pro plan.
 */

import {
  executeChatCompletion,
  executeChatCompletionStream,
  type AiModelTier,
  type VendorCallParams,
  type VendorCallResult,
  type VendorModelEntry,
  type VendorModule,
  type VendorStreamResult,
} from './types';
import { sanitizeExtraBodyForVendor } from '../jsonSchemaSanitize';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const EMBEDDINGS_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

/**
 * Default embedding model. NVIDIA's free Nemotron embed model is competitive
 * with OpenAI's small for English-only use cases, and is the model BurnRateOS
 * already calibrated against. Caller can override per-call via `body.model`.
 */
export const DEFAULT_EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';

export interface EmbeddingsCallParams {
  apiKey: string;
  model?: string;
  input: string | string[];
  /** Caller-supplied opaque pass-through (e.g. `dimensions`). */
  extraBody?: Record<string, unknown>;
}

export interface EmbeddingsCallResult {
  status: number;
  body: unknown;
}

/**
 * Call OpenRouter's OpenAI-compatible /embeddings. Single vendor for now —
 * if a second embeddings vendor lands, lift this into a vendor-module shape
 * mirroring `executeChatCompletion` and add a registry entry.
 */
export async function callOpenRouterEmbeddings(params: EmbeddingsCallParams): Promise<EmbeddingsCallResult> {
  const body: Record<string, unknown> = {
    model: params.model ?? DEFAULT_EMBEDDING_MODEL,
    input: params.input,
    ...(params.extraBody ?? {}),
  };
  const res = await fetch(EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      ...HEADERS,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  // ── FREE tier — drive builderforceLLM (free plan) and prefix the Pro fallback chain
  { id: 'google/gemma-4-31b-it:free',                tier: 'FREE', label: 'Gemma 4 31B (Free)',                 brand: 'Google'    },
  { id: 'google/gemma-4-26b-a4b-it:free',            tier: 'FREE', label: 'Gemma 4 26B (Free)',                 brand: 'Google'    },
  { id: 'openrouter/elephant-alpha',                 tier: 'FREE', label: 'OpenRouter Elephant Alpha (Free)',   brand: 'OpenRouter' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', tier: 'FREE', label: 'Hermes 3 (Llama 405B, Free)',        brand: 'NousResearch' },
  { id: 'openai/gpt-oss-120b:free',                  tier: 'FREE', label: 'GPT-OSS 120B (Free)',                brand: 'OpenAI'    },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',    tier: 'FREE', label: 'Llama 3.3 70B (Free)',               brand: 'Meta'      },
  { id: 'meta-llama/llama-3.2-3b-instruct:free',     tier: 'FREE', label: 'Llama 3.2 3B (Free)',                brand: 'Meta'      },
  { id: 'z-ai/glm-4.5-air:free',                     tier: 'FREE', label: 'GLM 4.5 Air (Free)',                 brand: 'Z.AI'      },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free',     tier: 'FREE', label: 'Qwen 3 Next 80B (Free)',             brand: 'Qwen'      },
  { id: 'nvidia/nemotron-nano-9b-v2:free',           tier: 'FREE', label: 'Nemotron Nano 9B (Free)',            brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free',       tier: 'FREE', label: 'Nemotron Nano 12B v2 VL (Free)',     brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',       tier: 'FREE', label: 'Nemotron 3 Nano 30B (Free)',         brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', tier: 'FREE', label: 'Nemotron 3 Nano Omni 30B Reasoning (Free)', brand: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free',    tier: 'FREE', label: 'Nemotron 3 Super 120B (Free)',       brand: 'NVIDIA'    },
  { id: 'qwen/qwen3-coder:free',                     tier: 'FREE', label: 'Qwen 3 Coder (Free)',                brand: 'Qwen'      },
  { id: 'inclusionai/ring-2.6-1t:free',              tier: 'FREE', label: 'Ring 2.6 1T (Free)',                 brand: 'InclusionAI' },
  { id: 'baidu/cobuddy:free',                        tier: 'FREE', label: 'CoBuddy (Free)',                     brand: 'Baidu'     },
  { id: 'baidu/qianfan-ocr-fast:free',               tier: 'FREE', label: 'Qianfan OCR Fast (Free)',            brand: 'Baidu'     },
  { id: 'poolside/laguna-xs.2:free',                 tier: 'FREE', label: 'Laguna XS.2 (Free)',                 brand: 'Poolside'  },
  { id: 'poolside/laguna-m.1:free',                  tier: 'FREE', label: 'Laguna M.1 (Free)',                  brand: 'Poolside'  },
  { id: 'minimax/minimax-m2.5:free',                 tier: 'FREE', label: 'MiniMax M2.5 (Free)',                brand: 'MiniMax'   },
  { id: 'liquid/lfm-2.5-1.2b-thinking:free',         tier: 'FREE', label: 'LFM 2.5 1.2B Thinking (Free)',       brand: 'Liquid'    },
  { id: 'liquid/lfm-2.5-1.2b-instruct:free',         tier: 'FREE', label: 'LFM 2.5 1.2B Instruct (Free)',       brand: 'Liquid'    },
  { id: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free', tier: 'FREE', label: 'Dolphin Mistral 24B Venice (Free)', brand: 'CognitiveComputations' },
  { id: 'openrouter/owl-alpha',                      tier: 'FREE', label: 'OpenRouter Owl Alpha (Free)',          brand: 'OpenRouter' },
  { id: 'deepseek/deepseek-v4-flash:free',           tier: 'FREE', label: 'DeepSeek V4 Flash (Free)',             brand: 'DeepSeek'  },
  { id: 'arcee-ai/trinity-large-thinking:free',      tier: 'FREE', label: 'Arcee Trinity Large Thinking (Free)',  brand: 'Arcee'     },
  { id: 'openai/gpt-oss-20b:free',                   tier: 'FREE', label: 'GPT-OSS 20B (Free)',                   brand: 'OpenAI'    },

  // ── STANDARD tier — paid low-cost models, prefixed in the paid pool so
  //    Pro/Teams tenants land on cheap models before reaching PREMIUM/ULTRA.
  { id: 'meta-llama/llama-3-8b-instruct',            tier: 'STANDARD', label: 'Llama 3 8B Instruct',      brand: 'Meta'      },
  { id: 'google/gemma-3-4b-it',                      tier: 'STANDARD', label: 'Gemma 3 4B Instruct',      brand: 'Google'    },
  { id: 'microsoft/phi-4',                           tier: 'STANDARD', label: 'Phi-4',                    brand: 'Microsoft' },
  { id: 'qwen/qwen3.5-9b',                           tier: 'STANDARD', label: 'Qwen 3.5 9B',              brand: 'Qwen'      },
  { id: 'z-ai/glm-4-32b',                            tier: 'STANDARD', label: 'GLM 4 32B',                brand: 'Z.AI'      },
  { id: 'openai/gpt-5-nano',                         tier: 'STANDARD', label: 'GPT-5 Nano',               brand: 'OpenAI'    },

  // ── STANDARD tier (cont.) — cheap current-gen frontier for routing/short tasks
  { id: 'anthropic/claude-haiku-4.5',                tier: 'STANDARD', label: 'Claude Haiku 4.5',     brand: 'Anthropic' },

  // ── PREMIUM tier — paid coding-grade models
  // Claude Sonnet 4.6 replaces the retired Claude 3.7 Sonnet (`claude-3-7-sonnet`
  // was retired on the first-party API 2026-02-19; current-gen Sonnet is 4.6).
  { id: 'anthropic/claude-sonnet-4.6',               tier: 'PREMIUM', label: 'Claude Sonnet 4.6',     brand: 'Anthropic' },
  { id: 'openai/gpt-4.1',                            tier: 'PREMIUM', label: 'GPT-4.1',               brand: 'OpenAI'    },
  { id: 'openai/o4-mini',                            tier: 'PREMIUM', label: 'o4-mini (reasoning)',   brand: 'OpenAI'    },
  { id: 'google/gemini-2.5-pro',                     tier: 'PREMIUM', label: 'Gemini 2.5 Pro',        brand: 'Google'    },
  { id: 'x-ai/grok-3-mini',                          tier: 'PREMIUM', label: 'Grok 3 Mini',           brand: 'xAI'       },
  { id: 'alibaba/qwen3.5-397b-a17b',                 tier: 'PREMIUM', label: 'Qwen 3.5 397B (MoE)',   brand: 'Alibaba'   },

  // NOTE: `google/gemini-2.5-flash-lite` is part of the vendor-diverse premium
  // fallback chain (see `PREMIUM_FALLBACK_MODELS` in LlmProxyService) and is
  // deliberately NOT listed in the catalog. Keeping it out of FREE_MODEL_POOL
  // and PRO_PAID_MODEL_POOL guarantees it only runs AFTER every primary
  // candidate has failed — never in the middle of a chain. Tier classification
  // falls through `tierForOpenRouterModel`'s heuristic and resolves to
  // 'STANDARD' for usage logging.
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForOpenRouterModel(modelId: string): AiModelTier {
  const known = CATALOG_BY_ID.get(modelId);
  if (known) return known.tier;
  // Unknown id — heuristic so tier remains classifiable for non-catalog overrides.
  const m = modelId.toLowerCase();
  if (m.includes(':free')) return 'FREE';
  if (m.includes('opus') || m.includes('gpt-o3')) return 'ULTRA';
  if (m.includes('claude') || m.includes('gpt-4') || m.includes('gemini-2.5-pro')) return 'PREMIUM';
  return 'STANDARD';
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  const { model, messages, tools, toolChoice, maxTokens, temperature, topP, extraBody } = params;
  // OpenRouter routes many free-tier model ids (`qwen/qwen3-coder:free`,
  // `qwen/qwen3-next-80b-a3b-instruct:free`, etc.) to Cerebras as the upstream
  // provider. Cerebras's strict JSON-Schema validator rejects draft-07
  // keywords like `maxLength` that Zod's `toJSONSchema()` emits by default —
  // strip them here so the call doesn't bounce with `[cerebras] 400` embedded
  // in the OpenRouter response. See jsonSchemaSanitize.ts for the keyword set.
  const safeExtra = sanitizeExtraBodyForVendor('openrouter', extraBody);
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...(safeExtra ?? {}),
  };
}

const HEADERS = { 'HTTP-Referer': 'https://builderforce.ai' };

export const openRouterModule: VendorModule = {
  id: 'openrouter',
  catalog: CATALOG,
  tierFor: tierForOpenRouterModel,
  apiKeyFrom(env) { return env.OPENROUTER_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'openrouter',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      headers: HEADERS,
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream({
      vendorId: 'openrouter',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      headers: HEADERS,
      ...(params.title ? { title: params.title } : {}),
      ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    });
  },
};
