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

/** JSON-Schema keywords NIM's guided-decoding grammar refuses. Add only on an observed
 *  upstream rejection — over-stripping silently weakens the delivered schema. */
export const NIM_UNSUPPORTED_SCHEMA_KEYWORDS: readonly string[] = ['propertyNames'];

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
  // `moonshotai/kimi-k2.6` is still LISTED by `/v1/models` but its NVCF function is gone
  // (`404 Function '23d4f03a-…': Not found`, 21× in 2026-10-03..10), so listing is not
  // proof of service here: it is superseded by K3 rather than kept.
  { id: 'moonshotai/kimi-k3',                           tier: 'FREE', label: 'Kimi K3 (NIM)',                  brand: 'Moonshot',  supersedes: ['moonshotai/kimi-k2.6'] },
  { id: 'z-ai/glm-5.3',                                 tier: 'FREE', label: 'GLM 5.3 (NIM)',                  brand: 'Z.AI',      supersedes: ['z-ai/glm-5.2'] },
  { id: 'deepseek-ai/deepseek-v4.1-flash',              tier: 'FREE', label: 'DeepSeek V4.1 Flash (NIM)',      brand: 'DeepSeek',  supersedes: ['deepseek-ai/deepseek-v4-flash-0731'] },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b',        tier: 'FREE', label: 'Nemotron 3.5 Lightning 30B (NIM)', brand: 'NVIDIA'  },
  { id: 'openai/gpt-oss-20b',                           tier: 'FREE', label: 'GPT-OSS 20B (NIM)',              brand: 'OpenAI'    },
  { id: 'mistralai/mistral-large-2-instruct',           tier: 'FREE', label: 'Mistral Large 2 (NIM)',          brand: 'Mistral'   },
  { id: 'google/gemma-4-31b-it',                        tier: 'FREE', label: 'Gemma 4 31B (NIM)',              brand: 'Google'    },
  { id: 'meta/llama-3.2-11b-vision-instruct',           tier: 'FREE', label: 'Llama 3.2 11B Vision (NIM)',     brand: 'Meta',      capabilities: ['vision'] },
  // RETIRED by NIM in the 2026-10-04 snapshot refresh, no same-family successor served:
  // `openai/gpt-oss-120b` (NIM now serves only 20B — a size downgrade, so no supersession
  // row), `mistralai/mistral-nemotron`, `meta/llama-3.3-70b-instruct`,
  // `stepfun-ai/step-3.7-flash`, `nvidia/nemotron-mini-4b-instruct`,
  // `nvidia/nemotron-nano-12b-v2-vl` (the NIM vision slot is now Llama 3.2 11B Vision).
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
  // NIM's guided-decoding grammar compiler rejects `propertyNames` outright
  // (`ValueError: Grammar error: Unimplemented keys: ["propertyNames"]`, 2026-10) —
  // which every `z.record(z.enum(...), …)` serialises to. Dropping it only loosens the
  // key constraint; the value shape is still enforced.
  schemaDialect: { stripKeywords: NIM_UNSUPPORTED_SCHEMA_KEYWORDS },
  // The 550B/120B Nemotrons are slow to first byte on NIM's free tier: 37 attempts
  // died at exactly the 15s free-plan budget in 2026-10-03..10. Declared here (not
  // on the catalog rows) so the budget is one reviewable line per model.
  attemptTimeoutMs: {
    byModel: {
      'nvidia/nemotron-3-ultra-550b-a55b': 45_000,
      'nvidia/nemotron-3-super-120b-a12b': 30_000,
    },
  },
});
