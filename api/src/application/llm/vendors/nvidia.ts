/**
 * NVIDIA NIM vendor module — free hosted inference at build.nvidia.com,
 * OpenAI-compatible chat-completions endpoint.
 *
 * Quotas (build.nvidia.com free tier, 2026-05): generous burst with daily
 * caps that reset at midnight UTC. Treat all catalog entries as FREE.
 *
 * NIM is OpenAI-compatible, so it's built from the shared
 * {@link createOpenAICompatibleVendor} factory. FREE-tier + `autoRoute: true` —
 * it stays in the auto-selected FREE pool exactly as before.
 */

import { createOpenAICompatibleVendor } from './openaiCompatible';
import type { VendorModelEntry } from './types';

/**
 * Free chat models hosted on NIM. Model ids match what NIM expects in the
 * `model` field of the request body (`<org>/<name>` form).
 */
const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'mistralai/mistral-medium-3.5-128b',            tier: 'FREE', label: 'Mistral Medium 3.5 128B (NIM)',  brand: 'Mistral'   },
  { id: 'nvidia/mistral-nemotron',                      tier: 'FREE', label: 'Mistral Nemotron (NIM)',         brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-mini-4b-instruct',             tier: 'FREE', label: 'Nemotron Mini 4B (NIM)',         brand: 'NVIDIA'    },
  { id: 'qwen/qwen3-coder-480b-a35b-instruct',          tier: 'FREE', label: 'Qwen 3 Coder 480B (NIM)',        brand: 'Qwen'      },
  { id: 'google/gemma-2-2b-it',                         tier: 'FREE', label: 'Gemma 2 2B (NIM)',               brand: 'Google'    },
  { id: 'google/gemma-3n-e4b-it',                       tier: 'FREE', label: 'Gemma 3n E4B (NIM)',             brand: 'Google'    },
  { id: 'microsoft/phi-4-multimodal-instruct',          tier: 'FREE', label: 'Phi-4 Multimodal (NIM)',         brand: 'Microsoft', capabilities: ['vision'] },
  // M3 (not M2.7) is the one currently flaky on NIM: confirmed 404s / hangs for many
  // callers as of 2026-08 (NVIDIA's own catalog + third-party reports), while M2.7 is
  // confirmed live. See the CODING_MODEL_POOL comment in modelPool.ts for the routing
  // side of this rollback.
  { id: 'minimaxai/minimax-m2.7',                       tier: 'FREE', label: 'MiniMax M2.7 (NIM)',             brand: 'MiniMax'   },
  { id: 'stepfun-ai/step-3.5-flash',                    tier: 'FREE', label: 'Step 3.5 Flash (NIM)',           brand: 'StepFun'   },
  { id: 'bytedance/seed-oss-36b-instruct',              tier: 'FREE', label: 'Seed OSS 36B (NIM)',             brand: 'ByteDance' },
  { id: 'abacusai/dracarys-llama-3_1-70b-instruct',     tier: 'FREE', label: 'Dracarys Llama 3.1 70B (NIM)',   brand: 'AbacusAI'  },
];

export const nvidiaModule = createOpenAICompatibleVendor({
  id: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
  apiKeyEnv: 'NVIDIA_API_KEY',
  catalog: CATALOG,
  defaultTier: 'FREE',
  autoRoute: true,
});
