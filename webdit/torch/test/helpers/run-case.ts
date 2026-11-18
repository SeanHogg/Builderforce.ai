import {
  F,
  cpu,
  intTensor,
  noGrad,
  tensor,
  type Backend,
  type DeviceTensor,
} from "../../src/autograd";
import { materialize, values, type OpCase } from "./op-cases";

/**
 * Runs an op case on a backend: forward, then backward of Σ(out · w) for a
 * fixed weight w, returning the output and every float input's gradient.
 */

export interface CaseResult {
  out: Float32Array;
  grads: Array<Float32Array | null>;
}

export function caseData(c: OpCase, caseIndex: number): number[][] {
  return c.inputs.map((spec, i) => materialize(spec, 1000 * (caseIndex + 1) + i));
}

export function makeInputs(c: OpCase, data: number[][], backend: Backend = cpu): DeviceTensor[] {
  return c.inputs.map((spec, i) =>
    spec.int
      ? intTensor(data[i]!, spec.shape, { backend })
      : tensor(data[i]!, spec.shape, { backend, requiresGrad: true }),
  );
}

export function weightsFor(shape: readonly number[]): number[] {
  return values(shape.reduce((a, b) => a * b, 1), 77, -1, 1);
}

export async function runCase(c: OpCase, data: number[][], backend: Backend = cpu): Promise<CaseResult> {
  const xs = makeInputs(c, data, backend);
  const out = c.build(xs);
  const w = tensor(weightsFor(out.shape), out.shape, { backend });
  F.sum(F.mul(out, w)).backward();
  const grads = await Promise.all(xs.map(async (x) => (x.grad ? ((await x.grad.data()) as Float32Array) : null)));
  return { out: (await out.data()) as Float32Array, grads };
}

/** Σ(out · w) evaluated in float64 on the host — the finite-difference objective. */
export async function objective(c: OpCase, data: number[][]): Promise<number> {
  const out = noGrad(() => c.build(makeInputs(c, data)));
  const o = await out.data();
  const w = weightsFor(out.shape);
  let acc = 0;
  for (let i = 0; i < o.length; i++) acc += o[i]! * w[i]!;
  return acc;
}

export function expectClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  atol: number,
  rtol: number,
  label: string,
): void {
  if (actual.length !== expected.length) throw new Error(`${label}: length ${actual.length} vs ${expected.length}`);
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    if (!(Math.abs(a - e) <= atol + rtol * Math.abs(e))) {
      throw new Error(`${label}[${i}]: got ${a}, expected ${e} (atol ${atol}, rtol ${rtol})`);
    }
  }
}
