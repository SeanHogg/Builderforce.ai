/**
 * NVIDIA NIM vendor module — free hosted inference at build.nvidia.com,
 * OpenAI-compatible chat-completions endpoint.
 *
 * Quotas (build.nvidia.com free tier, 2026-05): generous burst with daily
 * caps that reset at midnight UTC. Treat all catalog entries as FREE.
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

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Free chat models hosted on NIM. Model ids match what NIM expects in the
 * `model` field of the request body (`<org>/<name>` form).
 */
const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'mistralai/mistral-large-3-675b-instruct-2512', tier: 'FREE', label: 'Mistral Large 3 675B (NIM)',     brand: 'Mistral'   },
  { id: 'nvidia/mistral-nemotron',                      tier: 'FREE', label: 'Mistral Nemotron (NIM)',         brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-mini-4b-instruct',             tier: 'FREE', label: 'Nemotron Mini 4B (NIM)',         brand: 'NVIDIA'    },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct',          tier: 'FREE', label: 'Qwen 3 Coder 480B (NIM)',        brand: 'Qwen'      },
  { id: 'google/gemma-2-2b-it',                         tier: 'FREE', label: 'Gemma 2 2B (NIM)',               brand: 'Google'    },
  { id: 'google/gemma-3n-e4b-it',                       tier: 'FREE', label: 'Gemma 3n E4B (NIM)',             brand: 'Google'    },
  { id: 'microsoft/phi-4-multimodal-instruct',          tier: 'FREE', label: 'Phi-4 Multimodal (NIM)',         brand: 'Microsoft' },
  { id: 'minimax/minimax-m2.7',                         tier: 'FREE', label: 'MiniMax M2.7 (NIM)',             brand: 'MiniMax'   },
  { id: 'stepfun-ai/step-3.5-flash',                    tier: 'FREE', label: 'Step 3.5 Flash (NIM)',           brand: 'StepFun'   },
  { id: 'bytedance/seed-oss-36b-instruct',              tier: 'FREE', label: 'Seed OSS 36B (NIM)',             brand: 'ByteDance' },
  { id: 'abacusai/dracarys-llama-3_1-70b-instruct',     tier: 'FREE', label: 'Dracarys Llama 3.1 70B (NIM)',   brand: 'AbacusAI'  },
];

const CATALOG_BY_ID = new Map(CATALOG.map((m) => [m.id, m]));

function tierForNvidiaModel(modelId: string): AiModelTier {
  return CATALOG_BY_ID.get(modelId)?.tier ?? 'FREE';
}

function buildBody(params: VendorCallParams): Record<string, unknown> {
  const { model, messages, tools, toolChoice, maxTokens, temperature, topP, extraBody } = params;
  return {
    model,
    messages,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...(extraBody ?? {}),
  };
}

export const nvidiaModule: VendorModule = {
  id: 'nvidia',
  catalog: CATALOG,
  tierFor: tierForNvidiaModel,
  fallbackModel: 'nvidia/nemotron-mini-4b-instruct',
  apiKeyFrom(env) { return env.NVIDIA_API_KEY ?? null; },
  async call(params: VendorCallParams): Promise<VendorCallResult> {
    return executeChatCompletion({
      vendorId: 'nvidia',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: { ...buildBody(params), stream: false },
      ...(params.title ? { title: params.title } : {}),
    });
  },
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    return executeChatCompletionStream({
      vendorId: 'nvidia',
      endpoint: ENDPOINT,
      apiKey: params.apiKey,
      model: params.model,
      body: buildBody(params),
      ...(params.title ? { title: params.title } : {}),
    });
  },
};
