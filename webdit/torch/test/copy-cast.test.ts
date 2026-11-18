import { afterAll, describe, expect, it } from "vitest";
import { HostScope, cpu, tensor, tidy, type Backend } from "../src/autograd";
import { probeGpu } from "./helpers/gpu";

/**
 * The port's `copyInPlace` (bit-exact, aliasing-safe) and `cast`
 * (float32 ⇄ int32, truncating), on the CPU reference and on WebGPU; and
 * HostScope.run keeping a call's own error.
 */

const probe = await probeGpu();
afterAll(() => probe.backend?.destroy());

const backends: Array<[string, Backend | null]> = [
  ["cpu", cpu],
  ["webgpu", probe.backend],
];

describe.each(backends)("copyInPlace / cast (%s)", (_name, backend) => {
  it.skipIf(!backend)("copies bit-exactly over NaN / Inf, and is a no-op onto a view of itself", async () => {
    const be = backend!;
    const dst = be.upload(Float32Array.from([Number.NaN, Infinity, -Infinity, 1]), [4], "float32");
    const src = be.upload(Float32Array.from([0.1, -0, 3e-39, -2.5]), [4], "float32");
    be.copyInPlace(dst, src);
    expect(Array.from(await be.download(dst))).toEqual(Array.from(Float32Array.from([0.1, -0, 3e-39, -2.5])));
    const view = be.reshape(dst, [2, 2]);
    be.copyInPlace(dst, view);
    expect(Array.from(await be.download(dst))).toEqual(Array.from(Float32Array.from([0.1, -0, 3e-39, -2.5])));
    const ints = be.upload(Int32Array.from([7, -8, 2147483647]), [3], "int32");
    const intDst = be.upload(Int32Array.from([0, 0, 0]), [3], "int32");
    be.copyInPlace(intDst, ints);
    expect(Array.from(await be.download(intDst))).toEqual([7, -8, 2147483647]);
    for (const h of [dst, src, view, ints, intDst]) be.release(h);
  });

  it.skipIf(!backend)("casts float32 ⇄ int32, truncating toward zero", async () => {
    const be = backend!;
    const f = be.upload(Float32Array.from([1.9, -1.9, 0.5, -0.5, 3]), [5], "float32");
    const i = be.cast(f, "int32");
    expect(i.dtype).toBe("int32");
    expect(Array.from(await be.download(i))).toEqual([1, -1, 0, 0, 3]);
    const back = be.cast(i, "float32");
    expect(Array.from(await be.download(back))).toEqual([1, -1, 0, 0, 3]);
    for (const h of [f, i, back]) be.release(h);
  });
});

describe("HostScope.run", () => {
  it("rethrows the call's own error, not an imbalance error, and restores the stack", () => {
    const scope = new HostScope();
    expect(() =>
      scope.run(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    const t = tidy(() => tensor([1], [1]));
    expect(t.isDisposed).toBe(false);
  });
});
