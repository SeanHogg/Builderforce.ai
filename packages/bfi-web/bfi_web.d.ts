/* tslint:disable */
/* eslint-disable */

export interface BfiModelInfo { arch: string; contextTokens: number; vocab: number; params: number; kvF16: boolean }
export interface BfiLoadOptions { kvBudgetBytes?: number }
export interface BfiContextShape {
    layers: number; kvHeads: number; headDim: number; trainedContext: number;
    kvBudgetBytes?: number; f16?: boolean; maxBufferBytes?: number;
}
export interface BfiSupport { supported: boolean; reason?: string; maxBufferBytes: number; f16: boolean }



/**
 * bfi on WebGPU. See the crate docs and `README.md` for the JS contract.
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
     * downloading it (pure; same function the engine uses). Defaults:
     * `kvBudgetBytes` 2 GiB, `f16` false, `maxBufferBytes` 128 MiB (WebGPU's
     * guaranteed binding). The engine may serve less if allocation fails.
     */
    static contextFor(shape: BfiContextShape): number;
    /**
     * WebGPU adapter + device (`shader-f16` is requested when offered).
     * Rejects with `webgpu_unavailable: <reason>` when there is no adapter.
     */
    static create(): Promise<BfiEngine>;
    /**
     * Load a GGUF streamed by the host (the host owns download + cache).
     * Weights stay packed on the GPU, one buffer per tensor.
     */
    load(chunks: ReadableStream<Uint8Array>, totalBytes: number, onProgress: (loaded: number, total: number) => void, options: BfiLoadOptions): Promise<BfiModelInfo>;
    /**
     * Adapter probe only — no device — safe to call on every capability check.
     */
    static support(): Promise<BfiSupport>;
    /**
     * Drop the model and its GPU buffers. During a `chat`, the chat rejects
     * with `aborted` and the model is dropped when it unwinds.
     */
    unload(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bfiengine_free: (a: number, b: number) => void;
    readonly bfiengine_chat: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bfiengine_contextFor: (a: number) => number;
    readonly bfiengine_create: () => number;
    readonly bfiengine_load: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly bfiengine_support: () => number;
    readonly bfiengine_unload: (a: number) => void;
    readonly __wasm_bindgen_func_elem_4357: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_4375: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_2894: (a: number, b: number, c: number) => void;
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
