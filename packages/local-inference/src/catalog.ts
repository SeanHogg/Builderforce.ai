/**
 * The models a PAGE engine can offer — one row per model, as DATA.
 *
 * An HTTP runtime tells the probe what it serves; a page engine serves only what the page
 * has downloaded, and what it COULD download has to be written down somewhere. This is
 * that list. The picker renders it, `localModelFit` checks it against the device, the
 * download manager reads its `source`, and each engine's probe reports the rows it finds
 * in its cache — so adding a model is one row here, never a branch in a host.
 *
 * Sizes and windows are the publishers' own: the Bonsai rows from the GGUF files on
 * Hugging Face (`prism-ml/Bonsai-<N>-gguf`, `siblings[].size`) and their model cards; the
 * WebLLM rows from `@mlc-ai/web-llm@0.2.84`'s `prebuiltAppConfig` (`model_id`,
 * `context_window_size`, `low_resource_required`) and the summed size of each MLC repo.
 * `tools` is true ONLY where the engine honours `tools`: every model on `bfi` (it
 * grammar-constrains the call), and on WebLLM only the builds its
 * `functionCallingModelIds` lists.
 */

import { formatLocalModelRef } from './ref.js';
import type { LocalRuntimeId } from './runtimes.js';

/** Where a model's weights come from — the download manager's whole instruction. */
export type LocalModelSource =
  /** One file the host streams from `https://huggingface.co/<repo>/resolve/main/<file>`
   *  into its own cache (the `bfi` engine loads it from there). */
  | { kind: 'hf-file'; repo: string; file: string }
  /** A WebLLM prebuilt — WebLLM downloads and caches it itself. */
  | { kind: 'webllm'; modelId: string };

export interface LocalCatalogModel {
  /** The full `local/<runtime>/<model>` ref. */
  ref: string;
  runtime: LocalRuntimeId;
  /** The bare id the engine knows. */
  model: string;
  /** Picker label — a model name, so not localized. */
  label: string;
  /** Model family, for grouping (`bonsai`, `qwen3`, `llama-3.2`, `hermes-3`). */
  family: string;
  /** Parameter count. */
  params: number;
  /** Download size in bytes (what the picker shows and Cache Storage will hold). */
  bytes: number;
  /** The window the model was TRAINED for. What an engine actually serves can be
   *  smaller — `bfi` sizes its KV cache to the device (see `kv`). */
  contextTokens: number;
  /** The attention shape `bfi` sizes its KV cache from (`BfiEngine.contextFor`), so a
   *  probe reports the context the device will SERVE, not the trained one. */
  kv?: { layers: number; kvHeads: number; headDim: number };
  /** May take a TOOL turn on this engine. */
  tools: boolean;
  source: LocalModelSource;
  requires: {
    /** Needs the WebGPU `shader-f16` feature. */
    f16?: boolean;
    /** The largest single GPU buffer binding the model needs. */
    minBufferBytes: number;
  };
}

const MIB = 1024 * 1024;
/** WebGPU's default `maxStorageBufferBindingSize` — every adapter grants at least this. */
const WEBGPU_DEFAULT_BINDING_BYTES = 128 * MIB;
/** What WebLLM asks for when a model is not `low_resource_required`. */
const WEBLLM_FULL_BINDING_BYTES = 1024 * MIB;

/** A 1-bit Bonsai GGUF on `bfi`. Its largest packed tensor (the token embedding,
 *  151,669 × hidden at 18 bytes per 128 weights) is under 90 MB even at 8B, so the
 *  WebGPU default binding holds every tensor. Q1_0 scales are f16 but decoded in-shader,
 *  so `shader-f16` is not required. */
function bonsai(
  size: string,
  params: number,
  bytes: number,
  contextTokens: number,
  layers: number,
): LocalCatalogModel {
  const model = `bonsai-${size.toLowerCase()}-q1_0`;
  return {
    ref: formatLocalModelRef('bfi', model),
    runtime: 'bfi',
    model,
    label: `Bonsai ${size} (1-bit)`,
    family: 'bonsai',
    params,
    bytes,
    contextTokens,
    kv: { layers, kvHeads: 8, headDim: 128 },
    tools: true,
    source: { kind: 'hf-file', repo: `prism-ml/Bonsai-${size}-gguf`, file: `Bonsai-${size}-Q1_0.gguf` },
    requires: { minBufferBytes: WEBGPU_DEFAULT_BINDING_BYTES },
  };
}

/** A WebLLM prebuilt. Every row here is a `q4f16_1` build, so all need `shader-f16`. */
function webllm(
  modelId: string,
  fields: { label: string; family: string; params: number; bytes: number; contextTokens: number; tools: boolean; lowResource: boolean },
): LocalCatalogModel {
  return {
    ref: formatLocalModelRef('webllm', modelId),
    runtime: 'webllm',
    model: modelId,
    label: fields.label,
    family: fields.family,
    params: fields.params,
    bytes: fields.bytes,
    contextTokens: fields.contextTokens,
    tools: fields.tools,
    source: { kind: 'webllm', modelId },
    requires: { f16: true, minBufferBytes: fields.lowResource ? WEBGPU_DEFAULT_BINDING_BYTES : WEBLLM_FULL_BINDING_BYTES },
  };
}

/** Every model a page engine offers, smallest-first within each engine. */
export const LOCAL_MODEL_CATALOG: readonly LocalCatalogModel[] = [
  bonsai('1.7B', 1_700_000_000, 248_302_272, 32_768, 28),
  bonsai('4B', 4_000_000_000, 572_270_624, 32_768, 36),
  bonsai('8B', 8_190_000_000, 1_158_654_496, 65_536, 36),
  webllm('Qwen3-1.7B-q4f16_1-MLC', {
    label: 'Qwen3 1.7B',
    family: 'qwen3',
    params: 1_700_000_000,
    bytes: 984_156_278,
    contextTokens: 4_096,
    tools: false,
    lowResource: true,
  }),
  webllm('Llama-3.2-3B-Instruct-q4f16_1-MLC', {
    label: 'Llama 3.2 3B Instruct',
    family: 'llama-3.2',
    params: 3_210_000_000,
    bytes: 1_816_811_105,
    contextTokens: 4_096,
    tools: false,
    lowResource: true,
  }),
  webllm('Qwen3-4B-q4f16_1-MLC', {
    label: 'Qwen3 4B',
    family: 'qwen3',
    params: 4_000_000_000,
    bytes: 2_279_167_154,
    contextTokens: 4_096,
    tools: false,
    lowResource: true,
  }),
  webllm('Hermes-3-Llama-3.1-8B-q4f16_1-MLC', {
    label: 'Hermes 3 Llama 3.1 8B',
    family: 'hermes-3',
    params: 8_030_000_000,
    bytes: 4_526_847_881,
    contextTokens: 4_096,
    tools: true,
    lowResource: false,
  }),
];

/** The catalog row for a ref, or undefined. */
export function localCatalogModel(ref: string): LocalCatalogModel | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.ref === ref);
}

/** The catalog rows one engine offers. */
export function localCatalogFor(runtime: LocalRuntimeId): LocalCatalogModel[] {
  return LOCAL_MODEL_CATALOG.filter((m) => m.runtime === runtime);
}
