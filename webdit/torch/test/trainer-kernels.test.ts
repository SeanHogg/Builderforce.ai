import { afterAll, describe, expect, it } from "vitest";
import { cpu } from "../src/autograd";
import { ADAMW_WGSL, LORA_BACKWARD_WGSL, LORA_FORWARD_WGSL, TRAINER_PARAM_FLOATS } from "../src/backend/webgpu/kernels";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";
import { expectClose } from "./helpers/run-case";

/**
 * Backward compatibility of the moved kernels with their original consumer's
 * direct-dispatch contract (the old main-thread trainer, since replaced by the
 * engine-backed `frontend/src/lib/training/**`), which drove them with its OWN pipelines: one
 * 16-float parameter block it never writes past p[10] (so p[11] = 0), a 1-D
 * dispatch for LoRA backward and AdamW, and a 2-D one for LoRA forward. This
 * replays exactly that and checks the results against the CPU reference.
 */

const probe = await probeGpu();
afterAll(() => probe.backend?.destroy());

const STORAGE = 0x80 | 0x4 | 0x8;

describe.skipIf(!probe.backend)(`trainer-style dispatch of the moved kernels (${probe.reason})`, () => {
  it("LoRA forward/backward and AdamW behave as the trainer expects (gradient consumed)", async () => {
    const device = probe.backend!.device;
    const [rows, cols, rank] = [6, 10, 2];
    const base = Float32Array.from(values(rows * cols, 41));
    const A = Float32Array.from(values(rank * cols, 42));
    const B = Float32Array.from(values(rows * rank, 43));
    const gw = Float32Array.from(values(rows * cols, 44));
    const params = new Float32Array(TRAINER_PARAM_FLOATS);
    params.set([rows, cols, rank, 2]);

    const buf = (data: Float32Array) => {
      const b = device.createBuffer({ size: data.byteLength, usage: STORAGE });
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    const [bBase, bA, bB, bMerged, bGw, bGa, bGb, bMa, bVa, bP] = [
      buf(base), buf(A), buf(B), buf(new Float32Array(rows * cols)), buf(gw),
      buf(new Float32Array(A.length)), buf(new Float32Array(B.length)),
      buf(new Float32Array(A.length)), buf(new Float32Array(A.length)), buf(params),
    ];
    const run = (wgsl: string, bindings: GPUBuffer[], groups: [number, number, number]) => {
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: wgsl }), entryPoint: "main" } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: bindings.map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(...groups);
      pass.end();
      device.queue.submit([enc.finish()]);
    };
    const read = async (b: GPUBuffer, n: number) => {
      const s = device.createBuffer({ size: n * 4, usage: 0x1 | 0x8 });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(b, 0, s, 0, n * 4);
      device.queue.submit([enc.finish()]);
      await s.mapAsync(1);
      const out = new Float32Array(s.getMappedRange().slice(0));
      s.unmap();
      return out;
    };

    const g = Math.ceil((rows * cols) / 256);
    run(LORA_FORWARD_WGSL, [bBase, bA, bB, bMerged, bP], [Math.min(g, 65535), Math.ceil(g / 65535), 1]);
    run(LORA_BACKWARD_WGSL, [bGw, bA, bB, bGa, bGb, bP], [Math.ceil(Math.max(A.length, B.length) / 256), 1, 1]);
    params.set([0.01, 0.9, 0.999, 1e-8, 0.01, 1, 1], 4); // the trainer's step(): p[4..10], p[11] untouched
    device.queue.writeBuffer(bP, 0, params);
    run(ADAMW_WGSL, [bA, bGa, bMa, bVa, bP], [Math.ceil(A.length / 256), 1, 1]);

    // CPU reference through the engine's port.
    const up = (d: Float32Array, s: number[]) => cpu.upload(d, s, "float32");
    const merged = cpu.loraMerge(up(base, [rows, cols]), up(A, [rank, cols]), up(B, [rows, rank]), 2);
    const cA = up(A, [rank, cols]);
    const cGa = up(new Float32Array(A.length), [rank, cols]);
    const cGb = up(new Float32Array(B.length), [rows, rank]);
    cpu.loraBackward(up(gw, [rows, cols]), cA, up(B, [rows, rank]), 2, cGa, cGb);
    const gaBefore = await cpu.download(cGa);
    cpu.adamwStep(cA, cGa, up(new Float32Array(A.length), [rank, cols]), up(new Float32Array(A.length), [rank, cols]), {
      lr: 0.01, beta1: 0.9, beta2: 0.999, eps: 1e-8, weightDecay: 0.01, gradScale: 1, step: 1, keepGrad: false,
    });

    expectClose(await read(bMerged, rows * cols), await cpu.download(merged), 1e-5, 1e-4, "lora forward");
    expectClose(await read(bGb, B.length), await cpu.download(cGb), 1e-5, 1e-4, "lora backward gb");
    expectClose(await read(bA, A.length), await cpu.download(cA), 1e-5, 1e-4, "adamw weights");
    expect(gaBefore.some((x) => x !== 0)).toBe(true);
    expect(Array.from(await read(bGa, A.length)).every((x) => x === 0)).toBe(true); // consumed, as the trainer relies on
    for (const b of [bBase, bA, bB, bMerged, bGw, bGa, bGb, bMa, bVa, bP]) b.destroy();
  });
});
