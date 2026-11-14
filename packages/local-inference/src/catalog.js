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
 * Hugging Face (`prism-ml/Bonsai-<N>-gguf`, `siblings[].size`) and their model cards. The
 * WebLLM rows are GENERATED from the installed `@mlc-ai/web-llm`'s `prebuiltAppConfig`
 * (`scripts/gen-webllm-catalog.mjs` → `webllmCatalog.generated.ts`, held by a guard), so
 * a library bump is a regenerate, never a hand-edited row.
 * `tools` is true ONLY where the engine honours `tools`: every model on `bfi` (it
 * grammar-constrains the call), and on WebLLM only the builds its
 * `functionCallingModelIds` lists.
 */
import { formatLocalModelRef } from './ref.js';
import { WEBLLM_CATALOG } from './webllmCatalog.generated.js';
export { LOCAL_MODEL_USES } from './catalogEntry.js';
const MIB = 1024 * 1024;
/** WebGPU's default `maxStorageBufferBindingSize` — every adapter grants at least this. */
const WEBGPU_DEFAULT_BINDING_BYTES = 128 * MIB;
/** What WebLLM asks for when a model is not `low_resource_required`. */
const WEBLLM_FULL_BINDING_BYTES = 1024 * MIB;
const GIB = 1024 * MIB;
/** A 1-bit Bonsai GGUF on `bfi`. Its largest packed tensor (the token embedding,
 *  151,669 × hidden at 18 bytes per 128 weights) is under 90 MB even at 8B, so the
 *  WebGPU default binding holds every tensor. Q1_0 scales are f16 but decoded in-shader,
 *  so `shader-f16` is not required. Without WebGPU, `bfi` runs it on the CPU on a device
 *  with `cpuMinMemory` of RAM (packed weights + its KV cache live in wasm memory). */
function bonsai(size, params, bytes, contextTokens, layers, cpuMinMemory) {
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
        uses: ['chat'],
        recommended: true,
        source: { kind: 'hf-file', repo: `prism-ml/Bonsai-${size}-gguf`, file: `Bonsai-${size}-Q1_0.gguf` },
        requires: { minBufferBytes: WEBGPU_DEFAULT_BINDING_BYTES, cpu: { minDeviceMemoryBytes: cpuMinMemory } },
    };
}
/** A WebLLM prebuilt, from its generated entry (`webllmCatalog.generated.ts`). A row not
 *  `low_resource_required` asks for WebLLM's full 1 GiB binding; a build stating its own
 *  buffer need (`buffer_size_required_bytes`) asks for at least that. */
function webllm(entry) {
    const binding = entry.lowResource ? WEBGPU_DEFAULT_BINDING_BYTES : WEBLLM_FULL_BINDING_BYTES;
    return {
        ref: formatLocalModelRef('webllm', entry.modelId),
        runtime: 'webllm',
        model: entry.modelId,
        label: entry.label,
        family: entry.family,
        params: entry.params,
        bytes: entry.bytes,
        contextTokens: entry.contextTokens,
        tools: entry.tools,
        uses: entry.uses,
        recommended: entry.recommended,
        source: { kind: 'webllm', modelId: entry.modelId },
        requires: {
            ...(entry.f16 ? { f16: true } : {}),
            minBufferBytes: Math.max(binding, entry.bufferBytes ?? 0),
            vramBytes: entry.vramBytes,
        },
    };
}
/** Every model a page engine offers, smallest-first within each engine. */
export const LOCAL_MODEL_CATALOG = [
    // CPU floors: the device RAM a row needs to run without a GPU. An unreported RAM reads
    // as 2 GiB on a phone or tablet (Rust `kv_plan`), so there only 1.7B is offered, and as
    // 8 GiB on a desktop (`assumedDeviceMemoryBytes`); 4B needs 4 GiB, 8B 8 GiB — and every
    // row must also fit `cpuMemoryCeiling` (half the RAM, wasm32's cap).
    bonsai('1.7B', 1_700_000_000, 248_302_272, 32_768, 28, 2 * GIB),
    bonsai('4B', 4_000_000_000, 572_270_624, 32_768, 36, 4 * GIB),
    bonsai('8B', 8_190_000_000, 1_158_654_496, 65_536, 36, 8 * GIB),
    ...WEBLLM_CATALOG.map(webllm),
];
/**
 * May this row take a CHAT turn? Embedding builds feed the on-device embedder, never the
 * composer; vision-only builds wait until chat carries image input (PRD 34 §4). Both stay
 * in the catalog as data — `localCatalogModel` still finds them.
 */
export function isLocalChatModel(row) {
    return row.uses.some((use) => use !== 'vision' && use !== 'embedding');
}
/** The catalog row for a ref, or undefined. */
export function localCatalogModel(ref) {
    return LOCAL_MODEL_CATALOG.find((m) => m.ref === ref);
}
/** The CHAT rows one engine offers — what its probe may serve a turn from. */
export function localCatalogFor(runtime) {
    return LOCAL_MODEL_CATALOG.filter((m) => m.runtime === runtime && isLocalChatModel(m));
}
//# sourceMappingURL=catalog.js.map