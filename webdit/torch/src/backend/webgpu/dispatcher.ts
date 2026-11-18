import type { BufferPool } from "./buffer-pool";
import { BUFFER_USAGE, MAP_MODE_READ } from "./device";
import { WORKGROUP_SIZE } from "./kernels/common";
import { KERNEL_REGISTRY, type KernelName } from "./kernels/registry";

/**
 * Compiles registry kernels (once per device) and enqueues them. `run` is
 * synchronous: it encodes one compute pass and submits it; it never waits.
 * The only await is `read`, which maps a staging copy.
 *
 * Every binding is given its exact byte size, so a pooled buffer that is
 * larger than its tensor still reports the tensor's length to `arrayLength`.
 */

export interface Binding {
  buffer: GPUBuffer;
  bytes: number;
}

const MAX_GROUPS = 65535;

export class Dispatcher {
  private readonly pipelines = new Map<KernelName, GPUComputePipeline>();

  constructor(
    readonly device: GPUDevice,
    private readonly pool: BufferPool,
    private readonly features: ReadonlySet<string>,
  ) {}

  run(name: KernelName, bindings: Binding[], params: Uint32Array | Float32Array, threads: number): void {
    const entry = KERNEL_REGISTRY[name];
    if (bindings.length + 1 !== entry.bindings) {
      throw new Error(`${name}: kernel binds ${entry.bindings} buffers, got ${bindings.length + 1}`);
    }
    if (threads === 0) return;
    const paramBytes = Math.max(4, params.byteLength);
    const paramBuffer = this.pool.acquire(paramBytes);
    this.device.queue.writeBuffer(paramBuffer, 0, params.buffer, params.byteOffset, params.byteLength);
    const all = [...bindings, { buffer: paramBuffer, bytes: paramBytes }];
    const pipeline = this.pipeline(name);
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: all.map((b, binding) => ({ binding, resource: { buffer: b.buffer, offset: 0, size: b.bytes } })),
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    const groups = Math.ceil(threads / WORKGROUP_SIZE);
    if (entry.dispatch === "linear") {
      if (groups > MAX_GROUPS) throw new Error(`${name}: ${threads} threads exceed one dispatch row`);
      pass.dispatchWorkgroups(groups, 1, 1);
    } else {
      pass.dispatchWorkgroups(Math.min(groups, MAX_GROUPS), Math.ceil(groups / MAX_GROUPS), 1);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.pool.release(paramBuffer);
  }

  write(buffer: GPUBuffer, data: ArrayBufferView): void {
    this.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  async read(buffer: GPUBuffer, bytes: number): Promise<ArrayBuffer> {
    const size = Math.ceil(bytes / 4) * 4;
    const staging = this.device.createBuffer({ size, usage: BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    this.device.queue.submit([encoder.finish()]);
    try {
      await staging.mapAsync(MAP_MODE_READ);
      return staging.getMappedRange().slice(0, bytes);
    } finally {
      staging.unmap();
      staging.destroy();
    }
  }

  private pipeline(name: KernelName): GPUComputePipeline {
    const cached = this.pipelines.get(name);
    if (cached) return cached;
    const entry = KERNEL_REGISTRY[name];
    if ("requires" in entry && entry.requires && !this.features.has(entry.requires)) {
      throw new Error(`${name}: needs the "${entry.requires}" device feature, which this device lacks`);
    }
    const module = this.device.createShaderModule({ code: entry.wgsl });
    const pipeline = this.device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    this.pipelines.set(name, pipeline);
    return pipeline;
  }
}
