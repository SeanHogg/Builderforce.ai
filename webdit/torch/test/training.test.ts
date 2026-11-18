import { afterAll, describe, expect, it } from "vitest";
import { F, cpu, intTensor, manualSeed, nn, optim, tensor, type Backend } from "../src/autograd";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";

/**
 * End-to-end: a 2-layer MLP whose first layer is LoRA (frozen base, trainable
 * A/B) learns a fixed 3-class problem under a fixed seed. Loss must fall, the
 * frozen base must not move, the run must be bit-reproducible on CPU, and the
 * WebGPU run (when an adapter exists) must track the CPU run.
 */

const N = 32;
const STEPS = 40;
const X = values(N * 4, 101, -1, 1);
const M = [1, -1, 0.5, -0.5, 1, 1, 0.2, -1, 0.8, -0.6, 0.3, 0.9];
const Y = Array.from({ length: N }, (_, n) => {
  const scores = [0, 1, 2].map((c) => [0, 1, 2, 3].reduce((s, k) => s + X[n * 4 + k]! * M[k * 3 + c]!, 0));
  return scores.indexOf(Math.max(...scores));
});

async function train(backend: Backend): Promise<{ losses: number[]; baseBefore: number[]; baseAfter: number[] }> {
  manualSeed(20261117);
  const lora = new nn.LoRALinear(4, 16, { rank: 4, alpha: 8, backend });
  const model = new nn.Sequential(lora, new nn.Lambda(F.relu), new nn.Linear(16, 3, { backend }));
  const opt = new optim.AdamW(model.parameters(), { lr: 0.05, weightDecay: 0 });
  const x = tensor(X, [N, 4], { backend });
  const y = intTensor(Y, [N], { backend });
  const baseBefore = Array.from(await lora.base.weight.data());
  const losses: number[] = [];
  for (let step = 0; step < STEPS; step++) {
    model.zeroGrad();
    const loss = F.crossEntropy(model.forward(x), y);
    loss.backward();
    opt.step();
    if (step % 5 === 0 || step === STEPS - 1) losses.push(await loss.item());
  }
  const baseAfter = Array.from(await lora.base.weight.data());
  opt.dispose();
  return { losses, baseBefore, baseAfter };
}

describe("LoRA MLP training (CPU reference)", () => {
  it("reduces loss deterministically and leaves the base frozen", async () => {
    const run1 = await train(cpu);
    const run2 = await train(cpu);
    expect(run1.losses).toEqual(run2.losses);
    expect(run1.losses.at(-1)!).toBeLessThan(run1.losses[0]! * 0.6);
    expect(run1.baseAfter).toEqual(run1.baseBefore);
  });
});

const probe = await probeGpu();
afterAll(() => probe.backend?.destroy());

describe.skipIf(!probe.backend)(`LoRA MLP training (WebGPU; ${probe.reason})`, () => {
  it("reduces loss, leaves the base frozen and tracks the CPU run", async () => {
    const gpuRun = await train(probe.backend!);
    const cpuRun = await train(cpu);
    expect(gpuRun.losses.at(-1)!).toBeLessThan(gpuRun.losses[0]! * 0.6);
    expect(gpuRun.baseAfter).toEqual(gpuRun.baseBefore);
    gpuRun.losses.forEach((l, i) => expect(Math.abs(l - cpuRun.losses[i]!)).toBeLessThan(1e-3 + 1e-2 * cpuRun.losses[i]!));
  });
});
