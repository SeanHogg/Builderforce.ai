// Raw Markdown imports via webpack asset/source
declare module '*.md' {
  const content: string;
  export default content;
}

// mambacode.js — WebGPU-accelerated Mamba SSM library (SeanHogg/Mamba)
// The library ships as pure ESM without TypeScript declarations.
declare module 'mambacode.js' {
  export class MambaModel {
    constructor(device: GPUDevice, config: {
      vocabSize: number;
      dModel?: number;
      numLayers?: number;
      dState?: number;
      dConv?: number;
      expand?: number;
    });
    generate(
      promptIds: number[],
      maxNewTokens: number,
      options?: { temperature?: number }
    ): Promise<number[]>;
  }

  export class MambaTrainer {
    constructor(model: MambaModel, tokenizer: BPETokenizer);
    train(
      codeText: string,
      options?: {
        learningRate?: number;
        epochs?: number;
        wsla?: boolean;
        onEpochEnd?: (epoch: number, loss: number) => void;
      }
    ): Promise<number[]>;
  }

  export class BPETokenizer {
    readonly vocabSize: number;
    load(vocabUrl: string, mergesUrl: string): Promise<void>;
    encode(text: string): number[];
    decode(ids: number[]): string;
  }

  export function initWebGPU(): Promise<{ device: GPUDevice; adapter: GPUAdapter }>;

  export const VERSION: string;
  export const DESCRIPTION: string;
}


// WebGPU global type declarations for TypeScript
// These types are available in browsers supporting WebGPU

declare interface GPUShaderModule {}

declare interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

declare interface GPUBindGroupLayout {}

declare interface GPUBindGroupEntry {
  binding: number;
  resource: { buffer: GPUBuffer } | GPUSampler | GPUTextureView;
}

declare interface GPUBindGroup {}

declare interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

declare interface GPUDevice {
  createShaderModule(descriptor: { code: string }): GPUShaderModule;
  createComputePipelineAsync(descriptor: {
    layout: 'auto' | GPUPipelineLayout;
    compute: { module: GPUShaderModule; entryPoint: string };
  }): Promise<GPUComputePipeline>;
  createBindGroup(descriptor: {
    layout: GPUBindGroupLayout;
    entries: GPUBindGroupEntry[];
  }): GPUBindGroup;
  createBuffer(descriptor: { size: number; usage: number }): GPUBuffer;
  createCommandEncoder(): GPUCommandEncoder;
  queue: {
    writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  };
}

declare type GPUPipelineLayout = object;

declare interface GPUCommandEncoder {
  beginComputePass(): GPUComputePassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): GPUCommandBuffer;
}

declare interface GPUCommandBuffer {}

declare interface GPUBuffer {
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

declare const GPUBufferUsage: {
  STORAGE: number;
  COPY_DST: number;
  COPY_SRC: number;
  MAP_READ: number;
  UNIFORM: number;
};

declare const GPUMapMode: {
  READ: number;
};

declare interface GPUSampler {}
declare interface GPUTextureView {}

declare interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
}
declare interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}
declare interface Navigator {
  gpu?: GPU;
}

declare interface GPUDeviceDescriptor {}
declare interface GPURequestAdapterOptions {}
