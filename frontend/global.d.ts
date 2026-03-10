// Raw Markdown imports via webpack asset/source
declare module '*.md' {
  const content: string;
  export default content;
}

// WebGPU global type declarations for TypeScript
// These types are available in browsers supporting WebGPU

declare interface GPUDevice {
  createBuffer(descriptor: { size: number; usage: number }): GPUBuffer;
  createCommandEncoder(): GPUCommandEncoder;
  queue: {
    writeBuffer(buffer: GPUBuffer, offset: number, data: Float32Array): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  };
}

declare interface GPUCommandEncoder {
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): GPUCommandBuffer;
}

declare interface GPUCommandBuffer { }

declare interface GPUBuffer {
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

declare const GPUBufferUsage: {
  STORAGE: number;
  COPY_DST: number;
  COPY_SRC: number;
  MAP_READ: number;
};

declare const GPUMapMode: {
  READ: number;
};

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

declare interface GPUDeviceDescriptor { }
declare interface GPURequestAdapterOptions { }
