import { afterAll, describe, expect, it } from "vitest";
import { cpu, intTensor, tensor, type Backend, type BackendTensor } from "../src/autograd";
import { KERNEL_REGISTRY } from "../src/backend/webgpu/kernels/registry";
import { probeGpu } from "./helpers/gpu";
import { OP_CASES, values } from "./helpers/op-cases";
import { caseData, expectClose, runCase } from "./helpers/run-case";

/**
 * Every WebGPU kernel against the CPU reference: each op case's forward output
 * AND every input gradient (so each backward kernel runs too), then the update
 * kernels (AdamW, SGD, LoRA) driven directly through the port, and the large-
 * dispatch, fp16 and compile checks.
 *
 * Runs only with a real adapter (Dawn's Node binding); otherwise SKIPS with
 * the probe's reason.
 */

const probe = await probeGpu();
const gpu = probe.backend;
console.info(`[webgpu-parity] ${gpu ? "running" : "SKIPPED"} — ${probe.reason}`);

const ATOL = 1e-4;
const RTOL = 1e-3;
const BIG = 65535 * 256 + 1000; // past one dispatch row of workgroups

afterAll(() => gpu?.destroy());

describe.skipIf(!gpu)(`WebGPU ⇄ CPU parity (${probe.reason})`, () => {
  OP_CASES.forEach((c, index) => {
    it(c.name, async () => {
      const data = caseData(c, index);
      const ref = await runCase(c, data, cpu);
      const got = await runCase(c, data, gpu!);
      expectClose(got.out, ref.out, ATOL, RTOL, `${c.name} forward`);
      ref.grads.forEach((g, i) => {
        if (!g) return;
        expectClose(got.grads[i]!, g, ATOL, RTOL, `${c.name} d/dinput${i}`);
      });
    });
  });

  async function both<T extends BackendTensor>(
    fn: (be: Backend<T>, up: (d: number[], s: number[]) => T) => T[],
  ): Promise<Array<[Float32Array, Float32Array]>> {
    const run = async (be: Backend) => {
      const up = (d: number[], s: number[]) => be.upload(Float32Array.from(d), s, "float32") as T;
      const outs = fn(be as Backend<T>, up);
      return Promise.all(outs.map(async (h) => (await be.download(h)) as Float32Array));
    };
    const [r, g] = [await run(cpu), await run(gpu!)];
    return r.map((x, i) => [g[i]!, x]);
  }

  for (const keepGrad of [false, true]) {
    it(`adamw kernel (3 steps, grad scale, weight decay; keepGrad ${keepGrad})`, async () => {
      const n = 300;
      const pairs = await both((be, up) => {
        const w = up(values(n, 1), [n]);
        const m = up(new Array(n).fill(0), [n]);
        const v = up(new Array(n).fill(0), [n]);
        let g = up(values(n, 2), [n]);
        for (let step = 1; step <= 3; step++) {
          if (step > 1) g = up(values(n, 2 + step), [n]);
          be.adamwStep(w, g, m, v, { lr: 0.01, beta1: 0.9, beta2: 0.999, eps: 1e-8, weightDecay: 0.01, gradScale: 0.5, step, keepGrad });
        }
        return [w, m, v, g];
      });
      pairs.forEach(([g, r], i) => expectClose(g, r, 1e-5, 1e-3, `adamw out${i}`));
      const grad = Array.from(pairs[3]![0]);
      if (keepGrad) expect(grad).toEqual(Array.from(Float32Array.from(values(n, 5))));
      else expect(grad.every((x) => x === 0)).toBe(true); // the trainer's contract (p[11] = 0)
    });
  }

  it("sgd kernel with and without momentum", async () => {
    const n = 64;
    const pairs = await both((be, up) => {
      const w1 = up(values(n, 5), [n]);
      const w2 = up(values(n, 5), [n]);
      const buf = up(new Array(n).fill(0), [n]);
      for (let s = 0; s < 2; s++) {
        const g = up(values(n, 9 + s), [n]);
        be.sgdStep(w1, g, null, { lr: 0.1, momentum: 0, weightDecay: 0.05 });
        be.sgdStep(w2, g, buf, { lr: 0.1, momentum: 0.9, weightDecay: 0 });
      }
      return [w1, w2, buf];
    });
    pairs.forEach(([g, r], i) => expectClose(g, r, 1e-6, 1e-5, `sgd out${i}`));
  });

  it("lora_backward accumulates into existing gradients; add_inplace", async () => {
    const [rows, cols, rank] = [7, 9, 3];
    const pairs = await both((be, up) => {
      const gw = up(values(rows * cols, 11), [rows, cols]);
      const a = up(values(rank * cols, 12), [rank, cols]);
      const b = up(values(rows * rank, 13), [rows, rank]);
      const ga = up(values(rank * cols, 14), [rank, cols]);
      const gb = up(values(rows * rank, 15), [rows, rank]);
      be.loraBackward(gw, a, b, 2, ga, gb);
      const acc = up(values(rows * cols, 16), [rows, cols]);
      be.addInPlace(acc, gw);
      return [ga, gb, be.loraMerge(gw, a, b, 0.5), acc];
    });
    pairs.forEach(([g, r], i) => expectClose(g, r, 1e-5, 1e-4, `lora out${i}`));
  });

  it("embedding gradient: CSR (host-known ids) and atomic (device-resident ids) both match the CPU", async () => {
    const ids = [3, 0, 3, 7, 3, 1, 0, 9];
    const [vocab, dim] = [10, 5];
    const gyData = values(ids.length * dim, 31);
    const ref = (await cpu.download(
      cpu.embeddingBackward(cpu.upload(Int32Array.from(ids), [8], "int32"), cpu.upload(Float32Array.from(gyData), [8, dim], "float32"), vocab, null),
    )) as Float32Array;
    const gyGpu = gpu!.upload(Float32Array.from(gyData), [8, dim], "float32");
    const idsGpu = gpu!.upload(Int32Array.from(ids), [8], "int32");
    const csr = await gpu!.download(gpu!.embeddingBackward(idsGpu, gyGpu, vocab, Int32Array.from(ids)));
    const atomic = await gpu!.download(gpu!.embeddingBackward(idsGpu, gyGpu, vocab, null));
    expectClose(csr, ref, 1e-6, 1e-5, "embedding csr");
    expectClose(atomic, ref, 1e-5, 1e-4, "embedding atomic");
  });

  it("strided_copy moves int32 words unchanged", async () => {
    const ids = intTensor([1, 2, 3, 4, 5, 6], [2, 3], { backend: gpu! });
    const t = gpu!.stridedCopy(ids.handle as never, [3, 2], [1, 3], 0);
    expect(Array.from(await gpu!.download(t))).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it(`grid kernels spill past 65 535 workgroups into gid.y (${BIG} elements)`, async () => {
    const x = tensor(new Float32Array(BIG).fill(1), [BIG], { backend: gpu! });
    const out = (await gpu!.download(gpu!.affine(x.handle as never, 3, 1))) as Float32Array;
    expect(out.every((v) => v === 4)).toBe(true);
    x.dispose();
  });

  it(`adamw and sgd update a parameter of ${BIG} elements (> 16 776 960)`, async () => {
    const be = gpu!;
    const w = be.full([BIG], 1);
    const g = be.full([BIG], 2);
    const m = be.full([BIG], 0);
    const v = be.full([BIG], 0);
    be.adamwStep(w, g, m, v, { lr: 0.1, beta1: 0.9, beta2: 0.999, eps: 0, weightDecay: 0, gradScale: 1, step: 1, keepGrad: true });
    be.sgdStep(w, g, null, { lr: 0.25, momentum: 0, weightDecay: 0 });
    const out = (await be.download(w)) as Float32Array;
    // 1 - 0.1·(ĝ/|ĝ|) - 0.25·2 = 0.4 for EVERY element, the last one included.
    expect(out[0]).toBeCloseTo(0.4, 5);
    expect(out[BIG - 1]).toBeCloseTo(0.4, 5);
    expect(out.every((x) => Math.abs(x - 0.4) < 1e-5)).toBe(true);
    for (const h of [w, g, m, v]) be.release(h);
  });

  it.skipIf(!gpu?.supportsF16)("fp16 storage round-trips through the shader-f16 casts", async () => {
    const data = values(101, 21, -4, 4);
    const x = tensor(data, [101], { backend: gpu! });
    const packed = gpu!.toF16(x.handle as never);
    expect(packed.dtype).toBe("float16");
    expect(packed.shape).toEqual([101]);
    expect(packed.bytes).toBe(51 * 4);
    await expect(gpu!.download(packed)).rejects.toThrow(/fromF16/);
    expect(() => gpu!.fromF16(packed, [100])).toThrow(/does not hold/);
    const back = (await gpu!.download(gpu!.fromF16(packed))) as Float32Array;
    expectClose(back, data, 4e-3, 1e-3, "f16 round trip");
  });

  it("pool recycles released buffers instead of creating new ones", async () => {
    const before = gpu!.stats().buffersCreated;
    for (let i = 0; i < 20; i++) gpu!.release(gpu!.full([1000], i));
    expect(gpu!.stats().buffersCreated - before).toBeLessThanOrEqual(2);
  });

  it("every registry kernel compiles on this device (feature-gated ones only with the feature)", async () => {
    const features = new Set(gpu!.device.features);
    for (const [name, entry] of Object.entries(KERNEL_REGISTRY)) {
      if ("requires" in entry && entry.requires && !features.has(entry.requires)) continue;
      const module = gpu!.device.createShaderModule({ code: entry.wgsl });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error").map((m) => m.message);
      expect(errors, name).toEqual([]);
    }
  });
});

describe.skipIf(!gpu)(`WebGPU device health and pool policy (${probe.reason})`, () => {
  it("a lost device surfaces as DeviceLostError on the next op", async () => {
    const { WebGPUBackend, DeviceLostError } = await import("../src/backend/webgpu");
    const engine = await probe.newDevice();
    const be = new WebGPUBackend(engine);
    const x = be.full([4], 1);
    engine.device.destroy();
    await engine.device.lost;
    expect(() => be.full([4], 1)).toThrow(DeviceLostError);
    expect(() => be.affine(x, 2, 0)).toThrow(DeviceLostError);
    await expect(be.download(x)).rejects.toThrow(DeviceLostError);
  });

  it("an uncaptured GPU validation error is rethrown, typed, on the next op", async () => {
    const { WebGPUBackend, GpuOperationError } = await import("../src/backend/webgpu");
    const engine = await probe.newDevice();
    const be = new WebGPUBackend(engine, { ownsDevice: true });
    engine.device.createBuffer({ size: 4, usage: 0 }); // invalid: no usage
    let caught: unknown = null;
    for (let i = 0; i < 200 && !caught; i++) {
      await engine.device.queue.onSubmittedWorkDone();
      try {
        be.release(be.full([1], 0));
      } catch (error) {
        caught = error;
      }
    }
    expect(caught).toBeInstanceOf(GpuOperationError);
    expect(() => be.release(be.full([1], 0))).not.toThrow(); // reported once, then cleared
    be.destroy();
  });

  it("destroy() leaves a device the backend did not create alive", async () => {
    const { WebGPUBackend } = await import("../src/backend/webgpu");
    const engine = await probe.newDevice();
    new WebGPUBackend(engine).destroy();
    const lost = await Promise.race([engine.device.lost.then(() => true), new Promise((r) => setTimeout(() => r(false), 100))]);
    expect(lost).toBe(false);
    const again = new WebGPUBackend(engine, { ownsDevice: true });
    expect(Array.from(await again.download(again.full([2], 3)))).toEqual([3, 3]);
    again.destroy();
  });

  it("the pool trims idle buffers above its high-water mark, largest first", async () => {
    const { WebGPUBackend } = await import("../src/backend/webgpu");
    const engine = await probe.newDevice();
    const be = new WebGPUBackend(engine, { ownsDevice: true, maxPooledBytes: 64 * 1024 });
    const big = be.full([64 * 1024], 0); // 256 KiB
    const small = be.full([256], 0); // 1 KiB
    be.release(small);
    expect(be.stats().pooledBytes).toBe(1024);
    be.release(big); // pool would hold 257 KiB > 64 KiB cap ⇒ the big one goes
    expect(be.stats().pooledBytes).toBe(1024);
    const created = be.stats().buffersCreated;
    be.release(be.full([256], 1)); // the small class is still warm
    expect(be.stats().buffersCreated).toBe(created);
    be.destroy();
  });
});
