// WebGPU global type declarations for TypeScript
// These types are available in browsers supporting WebGPU

declare interface GPUDevice {
  createBuffer?(descriptor: { size: number; usage: number }): GPUBuffer;
  queue?: {
    writeBuffer(buffer: GPUBuffer, offset: number, data: Float32Array): void;
  };
}

declare interface GPUBuffer {
  destroy?(): void;
}
declare const GPUBufferUsage: {
  STORAGE: number;
  COPY_DST: number;
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

declare interface GPUDeviceDescriptor {}
declare interface GPURequestAdapterOptions {}
