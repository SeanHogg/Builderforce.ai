/**
 * Registry of OpenAI-compatible commercial LLM vendors.
 *
 * Each entry is a REAL integration: correct production base URL, correct Bearer
 * key env var, OpenAI `/chat/completions` wire format. They are built from the
 * shared {@link createOpenAICompatibleVendor} factory and registered in
 * `vendors/registry.ts`, so they participate in the gateway's routing / fallback
 * / cooldown machinery identically to the original seven vendors.
 *
 * Routing: these are `autoRoute: false` (explicit-pin-only). A caller reaches one
 * by pinning `<vendor>/<model-id>` (e.g. `groq/llama-3.3-70b-versatile`,
 * `deepseek/deepseek-chat`) — the registry's `VENDOR_PREFIXES` strips the prefix
 * and dispatches to the vendor. Keeping them out of the auto-selected FREE/PRO
 * pools means the carefully-tuned free/paid cascade ordering is unchanged; these
 * widen reach (the "30+ providers" surface) without disturbing default routing.
 *
 * Catalogs are intentionally small, current default model ids — enough for tier
 * classification + the admin health probe. A caller may pin ANY model id the
 * provider hosts via the prefix, not just catalog members.
 */

import { createOpenAICompatibleVendor, type VendorApiKeyEnv } from './openaiCompatible';
import type { VendorEnv, VendorModule } from './types';

/**
 * Declarative spec for one OpenAI-compatible vendor. Kept as data so the list is
 * scannable and the count is obvious. `models` are `<tier?>id` shorthand expanded
 * below into `VendorModelEntry`s (default tier STANDARD).
 */
interface VendorSpec {
  id: Parameters<typeof createOpenAICompatibleVendor>[0]['id'];
  baseUrl: string;
  apiKeyEnv: Parameters<typeof createOpenAICompatibleVendor>[0]['apiKeyEnv'];
  brand: string;
  /** Sibling regional host tried when `baseUrl` REJECTS a credential — set only
   *  for providers running two platforms with non-interchangeable keys. */
  altBaseUrl?: string;
  /** Default catalog model ids (real, current). */
  models: string[];
  /** Override the OpenAI `max_tokens` field name (rare). */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Extra static headers (rare). */
  headers?: Record<string, string>;
  noStream?: boolean;
  /** This upstream refuses the Worker's egress — run it from the tenant's connected
   *  runtime when one is online. See `VendorModule.requiresLocalEgress`. */
  requiresLocalEgress?: boolean;
}

const SPECS: ReadonlyArray<VendorSpec> = [
  {
    id: 'openai', brand: 'OpenAI', apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
  },
  {
    id: 'groq', brand: 'Groq', apiKeyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct', 'qwen/qwen3-32b'],
  },
  {
    id: 'deepseek', brand: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'mistral', brand: 'Mistral', apiKeyEnv: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'],
  },
  {
    id: 'together', brand: 'Together', apiKeyEnv: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'fireworks', brand: 'Fireworks', apiKeyEnv: 'FIREWORKS_API_KEY',
    baseUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-v3', 'accounts/fireworks/models/qwen2p5-72b-instruct'],
  },
  {
    id: 'deepinfra', brand: 'DeepInfra', apiKeyEnv: 'DEEPINFRA_API_KEY',
    baseUrl: 'https://api.deepinfra.com/v1/openai/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'xai', brand: 'xAI', apiKeyEnv: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    models: ['grok-4.5', 'grok-4.3', 'grok-3', 'grok-3-mini'],
  },
  {
    id: 'perplexity', brand: 'Perplexity', apiKeyEnv: 'PERPLEXITY_API_KEY',
    baseUrl: 'https://api.perplexity.ai/chat/completions',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning'],
  },
  {
    // Moonshot runs TWO independent Open Platforms whose keys are not
    // interchangeable: platform.moonshot.ai (international) and
    // platform.moonshot.cn (China). A key carries no marker for which issued it,
    // so pinning one host silently 401s the other platform's tenants. Default to
    // the international host — it matches the docs (`providers/moonshot.md`) and
    // the local runtime's `MOONSHOT_BASE_URL` — and let the factory fall back to
    // the China host when a credential is rejected there.
    id: 'moonshot', brand: 'Moonshot', apiKeyEnv: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.ai/v1/chat/completions',
    altBaseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    // Current K2 ids, kept in step with `docs-site/.../providers/moonshot.md`. The
    // credential health probe uses the FIRST entry, so the flagship leads: the
    // retired `moonshot-v1-*` models it used to probe fail on a perfectly good key.
    models: ['kimi-k2.5', 'kimi-k2-0905-preview', 'kimi-k2-turbo-preview', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
  },
  {
    id: 'kimi-code', brand: 'Kimi Code', apiKeyEnv: 'KIMI_CODE_API_KEY',
    baseUrl: 'https://api.kimi.com/coding/v1/chat/completions',
    // Kimi asks third-party coding clients to preserve their real identity. Do
    // not spoof kimi-code-cli/Claude/Codex; identify this gateway truthfully.
    headers: { 'User-Agent': 'Builderforce.ai' },
    // Kimi's edge returns an HTML 403 to the Cloudflare Workers egress BEFORE the
    // API reads the key — the same request from an ordinary machine gets a clean
    // JSON answer. So this vendor runs from the tenant's own connected runtime when
    // one is online: the personal interactive client the subscription is licensed
    // for. See `hostEgress.ts`; falls back to direct egress when nothing is online.
    requiresLocalEgress: true,
    // The relay is request/response, so an SSE body would arrive whole anyway. Being
    // honest about it here routes Kimi through the gateway's pseudo-stream instead of
    // pretending to stream and delivering one giant frame.
    noStream: true,
    // Keep the all-members model first: credential health probes use the first
    // catalog entry, while K3/high-speed access depends on the subscription tier.
    models: ['kimi-for-coding', 'k3-256k', 'k3', 'kimi-for-coding-highspeed'],
  },
  {
    id: 'qwen', brand: 'Qwen', apiKeyEnv: 'QWEN_API_KEY',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: ['qwen3-coder-plus', 'qwen3-max', 'qwen-plus', 'qwen-turbo'],
  },
  {
    id: 'hyperbolic', brand: 'Hyperbolic', apiKeyEnv: 'HYPERBOLIC_API_KEY',
    baseUrl: 'https://api.hyperbolic.xyz/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'novita', brand: 'Novita', apiKeyEnv: 'NOVITA_API_KEY',
    baseUrl: 'https://api.novita.ai/v3/openai/chat/completions',
    models: ['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct', 'deepseek/deepseek-v3'],
  },
  {
    id: 'sambanova', brand: 'SambaNova', apiKeyEnv: 'SAMBANOVA_API_KEY',
    baseUrl: 'https://api.sambanova.ai/v1/chat/completions',
    models: ['Meta-Llama-3.3-70B-Instruct', 'Qwen2.5-72B-Instruct', 'DeepSeek-V3-0324'],
  },
  {
    id: 'lepton', brand: 'Lepton', apiKeyEnv: 'LEPTON_API_KEY',
    baseUrl: 'https://api.lepton.ai/v1/chat/completions',
    models: ['llama3-3-70b', 'qwen2-5-72b', 'mixtral-8x7b'],
  },
  {
    id: 'anyscale', brand: 'Anyscale', apiKeyEnv: 'ANYSCALE_API_KEY',
    baseUrl: 'https://api.endpoints.anyscale.com/v1/chat/completions',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
  },
  {
    id: 'octoai', brand: 'OctoAI', apiKeyEnv: 'OCTOAI_API_KEY',
    baseUrl: 'https://text.octoai.run/v1/chat/completions',
    models: ['meta-llama-3.1-70b-instruct', 'mixtral-8x22b-instruct'],
  },
  {
    id: 'featherless', brand: 'Featherless', apiKeyEnv: 'FEATHERLESS_API_KEY',
    baseUrl: 'https://api.featherless.ai/v1/chat/completions',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  {
    id: 'inferencenet', brand: 'Inference.net', apiKeyEnv: 'INFERENCENET_API_KEY',
    baseUrl: 'https://api.inference.net/v1/chat/completions',
    models: ['meta-llama/llama-3.3-70b-instruct/fp-8', 'meta-llama/llama-3.1-8b-instruct/fp-8'],
  },
  {
    id: 'targon', brand: 'Targon', apiKeyEnv: 'TARGON_API_KEY',
    baseUrl: 'https://api.targon.com/v1/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'],
  },
  {
    id: 'avian', brand: 'Avian', apiKeyEnv: 'AVIAN_API_KEY',
    baseUrl: 'https://api.avian.io/v1/chat/completions',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1'],
  },
  {
    id: 'nebius', brand: 'Nebius', apiKeyEnv: 'NEBIUS_API_KEY',
    baseUrl: 'https://api.studio.nebius.com/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
  },
  {
    id: 'baseten', brand: 'Baseten', apiKeyEnv: 'BASETEN_API_KEY',
    baseUrl: 'https://inference.baseten.co/v1/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3-0324', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct'],
  },
  {
    id: 'lambda', brand: 'Lambda', apiKeyEnv: 'LAMBDA_API_KEY',
    baseUrl: 'https://api.lambda.ai/v1/chat/completions',
    models: ['llama-4-maverick-17b-128e-instruct-fp8', 'deepseek-v3-0324', 'qwen25-coder-32b-instruct'],
  },
  {
    id: 'klusterai', brand: 'Kluster.ai', apiKeyEnv: 'KLUSTERAI_API_KEY',
    baseUrl: 'https://api.kluster.ai/v1/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3-0324', 'klusterai/Meta-Llama-3.3-70B-Instruct-Turbo'],
  },
  {
    id: 'parasail', brand: 'Parasail', apiKeyEnv: 'PARASAIL_API_KEY',
    baseUrl: 'https://api.parasail.io/v1/chat/completions',
    models: ['parasail-deepseek-v3', 'parasail-llama-33-70b-instruct'],
  },
  {
    id: 'nscale', brand: 'nScale', apiKeyEnv: 'NSCALE_API_KEY',
    baseUrl: 'https://inference.api.nscale.com/v1/chat/completions',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
  },
  {
    id: 'chutes', brand: 'Chutes', apiKeyEnv: 'CHUTES_API_KEY',
    baseUrl: 'https://llm.chutes.ai/v1/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3-0324', 'deepseek-ai/DeepSeek-R1'],
  },
  {
    id: 'ai21', brand: 'AI21', apiKeyEnv: 'AI21_API_KEY',
    baseUrl: 'https://api.ai21.com/studio/v1/chat/completions',
    models: ['jamba-large-1.7', 'jamba-mini-1.7'],
  },
  {
    id: 'siliconflow', brand: 'SiliconFlow', apiKeyEnv: 'SILICONFLOW_API_KEY',
    baseUrl: 'https://api.siliconflow.com/v1/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
  },
  {
    id: 'minimax', brand: 'MiniMax', apiKeyEnv: 'MINIMAX_API_KEY',
    baseUrl: 'https://api.minimax.io/v1/chat/completions',
    models: ['MiniMax-M1', 'MiniMax-Text-01'],
  },
  {
    // Meta MUSE — OpenAI-compatible endpoint at api.meta.ai/v1.
    // Tenant BYO key stored as LlmProvider 'meta'; maps to this vendor so that
    // the gateway dispatches MUSE models on the tenant's own Meta AI account.
    // Reachable via explicit `direct/meta/<model-id>` pin or the BYO auto-seed.
    id: 'meta', brand: 'Meta AI', apiKeyEnv: 'META_API_KEY',
    baseUrl: 'https://api.meta.ai/v1/chat/completions',
    models: ['muse-spark-1.1'],
  },
];

/** All factory-built OpenAI-compatible vendor modules, in declaration order. */
export const openAICompatibleModules: ReadonlyArray<VendorModule> = SPECS.map((spec) =>
  createOpenAICompatibleVendor({
    id: spec.id,
    baseUrl: spec.baseUrl,
    ...(spec.altBaseUrl ? { altBaseUrl: spec.altBaseUrl } : {}),
    apiKeyEnv: spec.apiKeyEnv,
    catalog: spec.models.map((id) => ({
      id,
      label: `${id} (${spec.brand})`,
      brand: spec.brand,
      tier: 'STANDARD' as const,
    })),
    ...(spec.maxTokensField ? { maxTokensField: spec.maxTokensField } : {}),
    ...(spec.headers ? { headers: spec.headers } : {}),
    ...(spec.noStream ? { noStream: spec.noStream } : {}),
    ...(spec.requiresLocalEgress ? { requiresLocalEgress: spec.requiresLocalEgress } : {}),
  }),
);

/** Convenience map id→module for the registry's exhaustive `MODULES_BY_ID`. */
export const openAICompatibleModulesById: Record<string, VendorModule> = Object.fromEntries(
  openAICompatibleModules.map((m) => [m.id, m]),
);

/** The `VendorEnv` API-key field each factory vendor reads. Single source of truth
 *  for "which secrets power the OpenAI-compatible vendors" — drives the proxy's
 *  per-call env passthrough so the list can't drift from the registered vendors. */
export const OPENAI_COMPATIBLE_VENDOR_KEYS: ReadonlyArray<VendorApiKeyEnv> =
  SPECS.map((s) => s.apiKeyEnv);

/** Copy every bound OpenAI-compatible vendor key from a source env into a flat
 *  `Partial<VendorEnv>` (null when absent). Used by `LlmProxyService.vendorEnv()`
 *  to pass these keys through to the dispatcher without 30 lines of boilerplate. */
export function passthroughVendorKeys(env: VendorEnv): Partial<VendorEnv> {
  const out: Partial<VendorEnv> = {};
  for (const key of OPENAI_COMPATIBLE_VENDOR_KEYS) {
    out[key] = (env[key] as string | null | undefined) ?? null;
  }
  return out;
}
