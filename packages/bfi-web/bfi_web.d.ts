/* tslint:disable */
/* eslint-disable */

export type BfiBackend = "webgpu" | "cpu";
export interface BfiCreateOptions {
    /** `auto` (default): WebGPU when an adapter exists, else the CPU. */
    backend?: BfiBackend | "auto";
}
export interface BfiModelInfo {
    arch: string; backend: BfiBackend; contextTokens: number; vocab: number; params: number; kvF16: boolean
}
export interface BfiLoadOptions {
    /** Total KV-cache budget. Default 2 GiB on WebGPU, 512 MiB on the CPU. */
    kvBudgetBytes?: number
}
export interface BfiContextShape {
    layers: number; kvHeads: number; headDim: number; trainedContext: number;
    /** Which backend's rule to apply (default `webgpu`). `cpu`: f32 KV, no buffer cap,
     *  512 MiB default budget — what a CPU `load` serves. */
    backend?: BfiBackend;
    kvBudgetBytes?: number; f16?: boolean;
    maxStorageBufferBindingSizeBytes?: number;
    maxBufferSizeBytes?: number;
    /** @deprecated Alias of maxBufferSizeBytes (as in BfiSupport); min-ed with the binding limit. */
    maxBufferBytes?: number;
}
export interface BfiWebGpuSupport {
    supported: boolean; reason?: string;
    maxBufferBytes: number; maxStorageBufferBindingSizeBytes: number; f16: boolean
}
export interface BfiCpuSupport {
    supported: true;
    /** Built with WebAssembly SIMD128. */
    simd: boolean;
    /** Threads the kernels run on (1: single-threaded build). */
    threads: number;
    /** The CPU backend's default KV budget. */
    kvBudgetBytes: number;
    /** The memory the CPU backend may plan to use: min(wasm32's 4 GiB, half the device's
     *  RAM; an unreported RAM reads as 2 GiB). Weights + KV + working set must fit. */
    maxMemoryBytes: number;
    /** `navigator.deviceMemory` in bytes, where the browser reports it. */
    deviceMemoryBytes?: number
}
export interface BfiSupport {
    /** Top level = the WebGPU adapter, unchanged since version 2. */
    contractVersion: 2; supported: boolean; reason?: string;
    maxBufferSizeBytes: number; maxStorageBufferBindingSizeBytes: number;
    /** @deprecated Use maxBufferSizeBytes. */
    maxBufferBytes: number; requestedPowerPreference: string; f16: boolean;
    backends: { webgpu: BfiWebGpuSupport; cpu: BfiCpuSupport }
}



/**
 * bfi in the browser, on WebGPU or the CPU. See `README.md` for the JS contract.
 */
export class BfiEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * OpenAI `chat.completions` request JSON → OpenAI chunk JSON strings via
     * `onChunk` (when `stream: true`); resolves with the final completion JSON
     * (`usage`, `finish_reason`, `tool_calls`). Rejects with `aborted` on `signal`.
     */
    chat(requestJson: string, onChunk: (chunkJson: string) => void, signal: AbortSignal): Promise<string>;
    /**
     * Predict the context `load` will serve for a model shape, before
     * downloading it (pure; same function the engine uses). WebGPU defaults:
     * `kvBudgetBytes` 2 GiB, `f16` false, buffer cap 128 MiB (WebGPU's
     * guaranteed binding); the cap is `min(maxStorageBufferBindingSizeBytes,
     * maxBufferSizeBytes ?? maxBufferBytes)` of whichever are given, exactly as
     * `load` caps the adapter. `backend: 'cpu'`: f32 KV, 512 MiB default budget, no
     * cap. The engine may serve less if a WebGPU allocation fails.
     */
    static contextFor(shape: BfiContextShape): number;
    /**
     * Open a backend: `webgpu` (adapter + device, `shader-f16` when offered; rejects
     * `webgpu_unavailable: <reason>` without an adapter), `cpu`, or `auto` (default).
     */
    static create(options: BfiCreateOptions): Promise<BfiEngine>;
    /**
     * Load a GGUF streamed by the host (the host owns download + cache).
     * Weights stay packed — one GPU buffer per tensor, or packed in wasm memory.
     */
    load(chunks: ReadableStream<Uint8Array>, totalBytes: number, onProgress: (loaded: number, total: number) => void, options: BfiLoadOptions): Promise<BfiModelInfo>;
    /**
     * Every backend's capabilities; requests a WebGPU adapter only — no device — so it
     * is safe on every capability check.
     */
    static support(): Promise<BfiSupport>;
    /**
     * Drop the model and its memory. During a `chat`, the chat rejects with
     * `aborted` and the model is dropped when it unwinds.
     */
    unload(): void;
    /**
     * The backend this engine runs on.
     */
    readonly backend: BfiBackend;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bfiengine_free: (a: number, b: number) => void;
    readonly bfiengine_backend: (a: number, b: number) => void;
    readonly bfiengine_chat: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bfiengine_contextFor: (a: number) => number;
    readonly bfiengine_create: (a: number) => number;
    readonly bfiengine_load: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bfiengine_support: () => number;
    readonly bfiengine_unload: (a: number) => void;
    readonly __wasm_bindgen_func_elem_4553: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_4571: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_3086: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
