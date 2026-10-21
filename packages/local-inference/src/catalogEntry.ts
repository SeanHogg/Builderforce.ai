/**
 * The vocabulary a catalog row is described in — what a model is FOR, and the shape of
 * one generated WebLLM entry. Its own module so the generated data
 * (`webllmCatalog.generated.ts`) and the hand-written catalog (`catalog.ts`) share one
 * contract without importing each other's values.
 */

/** What a model is good at. A picker groups by it; the engines filter on it. */
export const LOCAL_MODEL_USES = ['chat', 'coding', 'reasoning', 'math', 'vision', 'embedding'] as const;
export type LocalModelUse = (typeof LOCAL_MODEL_USES)[number];

/**
 * One WebLLM prebuilt as `scripts/gen-webllm-catalog.mjs` reads it off
 * `@mlc-ai/web-llm`'s `prebuiltAppConfig` — DATA only; `catalog.ts` turns it into a row.
 */
export interface WebLlmCatalogEntry {
  modelId: string;
  label: string;
  family: string;
  params: number;
  /** Download size. Measured (the MLC repo's summed files) where the generator's
   *  table has it, otherwise ESTIMATED as params × the quantization's bits — the
   *  library ships no file size. `vramBytes` is what fit is judged on, never this. */
  bytes: number;
  contextTokens: number;
  /** In WebLLM's `functionCallingModelIds` — the only builds it honours `tools` for. */
  tools: boolean;
  /** `low_resource_required`: runs inside WebGPU's default 128 MiB binding. */
  lowResource: boolean;
  /** `vram_required_MB` in bytes — WebLLM's own figure for weights + KV + workspace. */
  vramBytes: number;
  /** Needs the WebGPU `shader-f16` feature (an f16 build, or `required_features`). */
  f16: boolean;
  /** `buffer_size_required_bytes`, where the library states one. */
  bufferBytes?: number;
  uses: readonly LocalModelUse[];
  /** On the curated short list a picker shows before "All models". */
  recommended: boolean;
}
