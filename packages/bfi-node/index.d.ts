/**
 * `@seanhogg/bfi-node` — `@seanhogg/bfi-web`'s `BfiEngine` contract, natively in Node.
 * The types are bfi-web's (spec 34 §3.1); `backend: 'webgpu'` here is the GPU through
 * wgpu on Vulkan (Metal on macOS).
 */
export type BfiBackend = 'webgpu' | 'cpu';

export interface BfiCreateOptions {
  backend?: BfiBackend | 'auto';
}

export interface BfiModelInfo {
  arch: string;
  backend: BfiBackend;
  contextTokens: number;
  vocab: number;
  params: number;
  kvF16: boolean;
}

export interface BfiLoadOptions {
  /** Total KV-cache budget. Default 2 GiB on the GPU; on the CPU a quarter of the RAM
   *  share the engine plans to use, from 512 MiB to 2 GiB (`support().backends.cpu.kvBudgetBytes`). */
  kvBudgetBytes?: number;
}

export interface BfiContextShape {
  layers: number;
  kvHeads: number;
  headDim: number;
  trainedContext: number;
  backend?: BfiBackend;
  kvBudgetBytes?: number;
  f16?: boolean;
  maxStorageBufferBindingSizeBytes?: number;
  maxBufferSizeBytes?: number;
  maxBufferBytes?: number;
}

export interface BfiSupport {
  contractVersion: 2;
  supported: boolean;
  reason?: string;
  maxBufferSizeBytes: number;
  maxStorageBufferBindingSizeBytes: number;
  maxBufferBytes: number;
  requestedPowerPreference: 'high-performance';
  f16: boolean;
  backends: {
    webgpu: { supported: boolean; reason?: string; maxBufferBytes: number; maxStorageBufferBindingSizeBytes: number; f16: boolean };
    cpu: { supported: true; simd: boolean; threads: number; kvBudgetBytes: number; maxMemoryBytes: number; deviceMemoryBytes?: number };
  };
}

export declare class BfiEngine {
  static create(options?: BfiCreateOptions): Promise<BfiEngine>;
  static support(): Promise<BfiSupport>;
  static contextFor(shape: BfiContextShape): number;
  readonly backend: BfiBackend;
  load(
    chunks: ReadableStream<Uint8Array>,
    totalBytes: number,
    onProgress?: (loaded: number, total: number) => void,
    options?: BfiLoadOptions,
  ): Promise<BfiModelInfo>;
  chat(requestJson: string, onChunk: (chunkJson: string) => void, signal?: AbortSignal): Promise<string>;
  unload(): void;
  dispose(): void;
}

/** `{ BfiEngine }` over the addon at `addonPath` (default: the prebuilt one beside this file). */
export declare function loadBfiNode(addonPath?: string): { BfiEngine: typeof BfiEngine };

/** `bfi_node.<platform>-<arch>.node`. */
export declare function addonFileName(platform?: string, arch?: string): string;
