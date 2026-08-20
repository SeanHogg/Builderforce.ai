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
  // Every id below is present in NIM's own `GET /v1/models` payload — the committed
  // snapshot the model-drift guard reconciles against (`liveModels.snapshot.json`,
  // refreshed by `npm run models:refresh`). NIM retires ids briskly: the previous
  // hand-maintained list had gone 10-of-11 dead, which meant most of the FREE pool's
  // NIM segment burned an attempt on a 404 before the cascade could advance. Do not
  // add an id here from memory — refresh the snapshot and take it from there.
  { id: 'nvidia/nemotron-3-ultra-550b-a55b',            tier: 'FREE', label: 'Nemotron 3 Ultra 550B (NIM)',    brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-3-super-120b-a12b',            tier: 'FREE', label: 'Nemotron 3 Super 120B (NIM)',    brand: 'NVIDIA'    },
  { id: 'moonshotai/kimi-k2.6',                         tier: 'FREE', label: 'Kimi K2.6 (NIM)',                brand: 'Moonshot'  },
  { id: 'z-ai/glm-5.2',                                 tier: 'FREE', label: 'GLM 5.2 (NIM)',                  brand: 'Z.AI'      },
  { id: 'deepseek-ai/deepseek-v4-flash-0731',           tier: 'FREE', label: 'DeepSeek V4 Flash (NIM)',        brand: 'DeepSeek'  },
  { id: 'openai/gpt-oss-120b',                          tier: 'FREE', label: 'GPT-OSS 120B (NIM)',             brand: 'OpenAI'    },
  { id: 'mistralai/mistral-large-2-instruct',           tier: 'FREE', label: 'Mistral Large 2 (NIM)',          brand: 'Mistral'   },
  { id: 'mistralai/mistral-nemotron',                   tier: 'FREE', label: 'Mistral Nemotron (NIM)',         brand: 'NVIDIA'    },
  { id: 'meta/llama-3.3-70b-instruct',                  tier: 'FREE', label: 'Llama 3.3 70B (NIM)',            brand: 'Meta'      },
  { id: 'stepfun-ai/step-3.7-flash',                    tier: 'FREE', label: 'Step 3.7 Flash (NIM)',           brand: 'StepFun'   },
  { id: 'google/gemma-4-31b-it',                        tier: 'FREE', label: 'Gemma 4 31B (NIM)',              brand: 'Google'    },
  { id: 'nvidia/nemotron-mini-4b-instruct',             tier: 'FREE', label: 'Nemotron Mini 4B (NIM)',         brand: 'NVIDIA'    },
  { id: 'nvidia/nemotron-nano-12b-v2-vl',               tier: 'FREE', label: 'Nemotron Nano 12B VL (NIM)',     brand: 'NVIDIA',    capabilities: ['vision'] },
  // DELIBERATELY ABSENT: `minimaxai/minimax-m2.7`. NIM has retired it, and the only
  // MiniMax id it still serves is `minimax-m3` — the generation that was rolled back
  // on 2026-08-17 for 404ing and hanging mid-stream. Re-listing M3 would put a model
  // we already measured as unreliable back at the head of the free coding pool, so
  // the entry is dropped rather than bumped; the coding pool now leads with the
  // OpenRouter Nemotron 3 Ultra free slug. Reinstate M3 only with fresh evidence.
];

export const nvidiaModule = createOpenAICompatibleVendor({
  id: 'nvidia',
  baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
  apiKeyEnv: 'NVIDIA_API_KEY',
  catalog: CATALOG,
  defaultTier: 'FREE',
  autoRoute: true,
});
