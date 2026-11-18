import { afterAll, describe, expect, it } from "vitest";
import { DeviceTensor, F, cpu, intTensor, tensor, type Backend } from "../src/autograd";
import { probeGpu } from "./helpers/gpu";

/**
 * Out-of-range indices behave the same on every backend when the host knows
 * them: `embedding` / `cross_entropy` throw before dispatch. Device-resident
 * indices (never seen by the host) are documented to read as a zero row /
 * clamp on WebGPU instead of stalling for a readback.
 */

const probe = await probeGpu();
afterAll(() => probe.backend?.destroy());
const backends: Array<[string, Backend | null]> = [
  ["cpu", cpu],
  ["webgpu", probe.backend],
];

describe.each(backends)("host-known index validation (%s)", (name, backend) => {
  it.skipIf(!backend)(`embedding rejects an out-of-range id before dispatch (${name === "webgpu" ? probe.reason : "reference"})`, () => {
    const w = tensor(new Array(6).fill(1), [3, 2], { backend: backend! });
    expect(() => F.embedding(intTensor([0, 3], [2], { backend: backend! }), w)).toThrow(
      /^embedding: index 3 at position 1 out of range \[0, 3\)$/,
    );
    expect(() => F.embedding(intTensor([-1], [1], { backend: backend! }), w)).toThrow(/index -1/);
  });

  it.skipIf(!backend)("the check survives reshape", () => {
    const w = tensor(new Array(6).fill(1), [3, 2], { backend: backend! });
    const ids = F.reshape(intTensor([0, 1, 2, 5], [4], { backend: backend! }), [2, 2]);
    expect(() => F.embedding(ids, w)).toThrow(/index 5/);
  });

  it.skipIf(!backend)("cross_entropy rejects an out-of-range target", () => {
    const logits = tensor(new Array(6).fill(0), [2, 3], { backend: backend! });
    expect(() => F.crossEntropy(logits, intTensor([1, 3], [2], { backend: backend! }))).toThrow(
      /^cross_entropy: index 3 at position 1 out of range \[0, 3\)$/,
    );
  });
});

describe.skipIf(!probe.backend)(`device-resident indices on WebGPU (${probe.reason})`, () => {
  it("an unchecked out-of-range id reads as a zero row; a target is clamped", async () => {
    const gpu = probe.backend!;
    const deviceIds = new DeviceTensor(gpu, gpu.upload(Int32Array.from([1, 7]), [2], "int32"));
    const w = tensor([1, 2, 3, 4, 5, 6], [3, 2], { backend: gpu });
    expect(Array.from(await F.embedding(deviceIds, w).data())).toEqual([3, 4, 0, 0]);

    const logits = tensor([0, 0, 5], [1, 3], { backend: gpu });
    const deviceTarget = new DeviceTensor(gpu, gpu.upload(Int32Array.from([9]), [1], "int32"));
    const clamped = await F.crossEntropy(logits, deviceTarget, "none").item();
    const expected = await F.crossEntropy(logits, intTensor([2], [1], { backend: gpu }), "none").item();
    expect(clamped).toBeCloseTo(expected, 6);
  });

  it("an unchecked out-of-range target is clamped identically in the gradient", async () => {
    const gpu = probe.backend!;
    const run = async (target: DeviceTensor) => {
      const logits = tensor([0.5, -1, 2], [1, 3], { backend: gpu, requiresGrad: true });
      F.crossEntropy(logits, target).backward();
      return Array.from(await logits.grad!.data());
    };
    const clamped = await run(new DeviceTensor(gpu, gpu.upload(Int32Array.from([9]), [1], "int32")));
    const explicit = await run(intTensor([2], [1], { backend: gpu }));
    clamped.forEach((g, i) => expect(g).toBeCloseTo(explicit[i]!, 6));
  });
});

describe("unchecked indices on the CPU reference", () => {
  it("throws even when the host never saw the values", () => {
    const ids = new DeviceTensor(cpu, cpu.upload(Int32Array.from([7]), [1], "int32"));
    expect(() => F.embedding(ids, tensor([1, 2], [1, 2]))).toThrow(/out of range/);
  });
});
