/**
 * Can THIS device run a catalog model? Answered from what the GPU reports — WebGPU
 * present, `shader-f16` offered, the largest buffer binding it grants — before anyone
 * downloads a gigabyte to find out. Pure: the host asks its engine for the support
 * record (`BfiEngine.support()` or a WebGPU adapter read) and passes it in.
 */

/** What the device's WebGPU adapter offers. Never requires creating a device. */
interface LocalDeviceSupport {
    /** Version of the cross-language support record. */
    contractVersion?: 2;
    supported: boolean;
    /** Why WebGPU is unavailable, when `supported` is false. */
    reason?: string;
    f16: boolean;
    /** Adapter `maxBufferSize`: the largest allocatable GPU buffer. */
    maxBufferSizeBytes?: number;
    /** Adapter `maxStorageBufferBindingSize`: the largest storage-buffer binding. */
    maxStorageBufferBindingSizeBytes?: number;
    /** @deprecated Version 1 conflated the two limits. Use the explicit fields. */
    maxBufferBytes: number;
    /** Requested adapter preference, not a claim about the selected hardware. */
    requestedPowerPreference?: 'high-performance' | 'low-power';
}
/** Why a model cannot run here — a stable code a picker maps to copy. */
type LocalModelUnfit = 'webgpu_unavailable' | 'shader_f16_unavailable' | 'buffer_too_small';

/**
 * Our transformer — Synapse's `bfi` compiled to WebAssembly over WebGPU (`bfi-web`,
 * PRD 34 §3.1) — as a page engine answering the `bfi` runtime's chat route.
 *
 * The wasm package is vendored by the host, so this adapter takes its loader as a
 * dependency (`loadBfi`) rather than importing it: brain-embedded compiles and tests
 * without it, and a host that never offers `bfi` never fetches the wasm.
 *
 * The host owns download and cache (the `hf-file` model store); `bfi` only ever reads
 * weights the store already holds. A probe looks in the store FIRST and answers null
 * without loading the wasm when no Bonsai file is there; a chat call for a model that is
 * not downloaded is a 503 before anything streams. `tools` is honoured for every model —
 * `bfi` grammar-constrains the call.
 *
 * The window a probe reports is the one the engine will SERVE: `bfi` sizes its KV cache
 * to the device (a 2 GiB budget, f16 when the adapter has `shader-f16`), so Bonsai 8B's
 * trained 65,536 tokens become ~14k in a browser. Before a load that is
 * `BfiEngine.contextFor` over the row's KV shape — the engine's own formula, never a
 * copy of it — and after one it is what the load actually allocated.
 */

/** `bfi-web`'s model summary (§3.1). */
interface BfiModelInfo {
    arch: string;
    /** The context the load actually allocated (≤ the trained window). */
    contextTokens: number;
    vocab: number;
    params: number;
    kvF16?: boolean;
}
/** `BfiEngine.contextFor`'s input: a model's attention shape plus the device. */
interface BfiContextShape {
    layers: number;
    kvHeads: number;
    headDim: number;
    trainedContext: number;
    kvBudgetBytes?: number;
    f16?: boolean;
    maxStorageBufferBindingSizeBytes?: number;
    /** @deprecated Use maxStorageBufferBindingSizeBytes. */
    maxBufferBytes?: number;
}
/** A live `BfiEngine` (§3.1) — structurally typed so the wasm package is not a build dep. */
interface BfiEngineInstance {
    load(chunks: ReadableStream<Uint8Array>, totalBytes: number, onProgress?: (loaded: number, total: number) => void): Promise<BfiModelInfo>;
    chat(requestJson: string, onChunk: (chunkJson: string) => void, signal?: AbortSignal): Promise<string>;
    unload(): void;
}
/** The `BfiEngine` class's statics (§3.1). */
interface BfiEngineStatic {
    create(): Promise<BfiEngineInstance>;
    support(): Promise<LocalDeviceSupport>;
    /** The context a load will serve on this shape and device (pure; 0 on a bad shape). */
    contextFor(shape: BfiContextShape): number;
}
interface BfiModule {
    BfiEngine: BfiEngineStatic;
}

export type { BfiModule as B, LocalModelUnfit as L, BfiEngineInstance as a, BfiEngineStatic as b, BfiModelInfo as c };
