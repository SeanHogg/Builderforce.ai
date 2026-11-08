/**
 * Selective-scan step runner: WebGPU when a device is supplied, CPU otherwise.
 *
 * The recurrence is h'[c,k] = decay * h[c,k] + gain * u[c]. `selectiveScanStepCpu`
 * is the reference; the WGSL kernel (kernels/selective-scan.wgsl.ts) computes the
 * identical thing. `selectiveScanStep` is the dispatcher: no device, or any GPU
 * failure, falls back to the CPU loop so callers never lose the state advance.
 */

import { SELECTIVE_SCAN_STEP_WGSL, SELECTIVE_SCAN_WORKGROUP_SIZE } from './kernels/selective-scan.wgsl';

export const DEFAULT_SCAN_DECAY = 0.92;
export const DEFAULT_SCAN_GAIN = 0.1;

export interface ScanStepArgs {
  /** Flat state, length channels * order. Missing cells read as 0. */
  state: ArrayLike<number>;
  /** Pooled per-channel input, length channels. */
  pooled: Float32Array;
  channels: number;
  order: number;
  decay: number;
  gain: number;
}

/** CPU reference implementation (Float32 accumulation, matches the kernel). */
export function selectiveScanStepCpu(a: ScanStepArgs): Float32Array {
  const next = new Float32Array(a.channels * a.order);
  for (let c = 0; c < a.channels; c++) {
    for (let k = 0; k < a.order; k++) {
      const idx = c * a.order + k;
      next[idx] = a.decay * (a.state[idx] ?? 0) + a.gain * a.pooled[c];
    }
  }
  return next;
}

/** Run one scan step on the GPU. Throws on any WebGPU failure. */
export async function selectiveScanStepGpu(device: GPUDevice, a: ScanStepArgs): Promise<Float32Array> {
  const total = a.channels * a.order;
  const bytes = Math.max(4, total * 4);

  const params = new ArrayBuffer(16);
  const pv = new DataView(params);
  pv.setUint32(0, a.channels, true);
  pv.setUint32(4, a.order, true);
  pv.setFloat32(8, a.decay, true);
  pv.setFloat32(12, a.gain, true);

  const state = new Float32Array(Math.max(1, total));
  for (let i = 0; i < total; i++) state[i] = a.state[i] ?? 0;
  const pooled = new Float32Array(Math.max(1, a.channels));
  pooled.set(a.pooled.subarray(0, a.channels));

  const buffers: GPUBuffer[] = [];
  const make = (size: number, usage: number, data?: BufferSource): GPUBuffer => {
    const buf = device.createBuffer({ size, usage });
    if (data) device.queue.writeBuffer(buf, 0, data);
    buffers.push(buf);
    return buf;
  };

  try {
    const paramBuf = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, params);
    const stateBuf = make(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, state);
    const pooledBuf = make(Math.max(4, a.channels * 4), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, pooled);
    const nextBuf = make(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const readBuf = make(bytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: SELECTIVE_SCAN_STEP_WGSL }), entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [paramBuf, stateBuf, pooledBuf, nextBuf].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(total / SELECTIVE_SCAN_WORKGROUP_SIZE)));
    pass.end();
    enc.copyBufferToBuffer(nextBuf, 0, readBuf, 0, bytes);
    device.queue.submit([enc.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readBuf.getMappedRange().slice(0, total * 4));
    readBuf.unmap();
    return out;
  } finally {
    for (const b of buffers) b.destroy();
  }
}

/**
 * Dispatcher: GPU when `device` is given and succeeds, otherwise the CPU
 * reference. A GPU failure is non-fatal (the state advance must not abort a
 * generation) so it degrades silently to CPU.
 */
export async function selectiveScanStep(a: ScanStepArgs, device?: GPUDevice | null): Promise<Float32Array> {
  if (device && a.channels * a.order > 0) {
    try {
      return await selectiveScanStepGpu(device, a);
    } catch {
      // fall through to CPU
    }
  }
  return selectiveScanStepCpu(a);
}
