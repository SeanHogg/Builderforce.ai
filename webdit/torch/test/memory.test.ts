import { afterAll, describe, expect, it } from "vitest";
import {
  F,
  cpu,
  intTensor,
  manualSeed,
  nn,
  noGrad,
  optim,
  tensor,
  tidy,
  type Backend,
} from "../src/autograd";
import { counting } from "./helpers/counting-backend";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";

/**
 * Deterministic memory: a training step run in `tidy`, with no await between
 * steps (so no finalizer can run), holds a CONSTANT number of live handles —
 * every activation, saved value and gradient temporary is released by the
 * step itself. Checked on the CPU through a handle-counting wrapper (runs in
 * CI) and on WebGPU through the pool's live bytes.
 */

function setup(backend: Backend, scoped = true) {
  manualSeed(99);
  const model = new nn.Sequential(
    new nn.LoRALinear(6, 12, { rank: 2, backend }),
    new nn.LayerNorm(12, 1e-5, { backend }),
    new nn.Lambda(F.gelu),
    new nn.Linear(12, 4, { backend }),
  );
  const emb = new nn.Embedding(9, 6, { backend });
  const opt = new optim.AdamW([...model.parameters(), ...emb.parameters()], { lr: 0.01 });
  const ids = intTensor([1, 4, 4, 8, 0, 2, 7, 3], [8], { backend });
  const targets = intTensor([0, 3, -100, 1, 2, 2, 3, 0], [8], { backend });
  const body = () => {
    model.zeroGrad();
    emb.zeroGrad();
    const logits = model.forward(F.add(emb.forward(ids), F.softmax(F.exp(tensor(values(48, 5), [8, 6], { backend })))));
    const loss = F.crossEntropy(logits, targets);
    loss.backward();
    opt.step();
    noGrad(() => F.logSoftmax(logits)); // an inference op inside the step: its saved value is dropped at once
  };
  return scoped ? () => tidy(body) : body;
}

describe("memory stays flat across synchronous training steps", () => {
  it("CPU: constant live handles (no finalizer involved)", () => {
    const { backend, live } = counting(cpu);
    const step = setup(backend);
    step(); // warm-up: optimizer state and .grad are created once
    step();
    const after2 = live();
    for (let i = 0; i < 20; i++) step();
    expect(live()).toBe(after2);
  });

  it("CPU control: the same step WITHOUT tidy grows (the counter sees leaks)", () => {
    const { backend, live } = counting(cpu);
    const step = setup(backend, false);
    step();
    step();
    const after2 = live();
    step();
    expect(live()).toBeGreaterThan(after2);
  });

  it("tidy keeps what it returns and disposes the rest", () => {
    const x = tensor([1, 2], [2]);
    let inner: ReturnType<typeof F.add> | null = null;
    const kept = tidy(() => {
      inner = F.add(x, x);
      return F.mul(inner, x);
    });
    expect(inner!.isDisposed).toBe(true);
    expect(kept.isDisposed).toBe(false);
    expect(x.isDisposed).toBe(false);
  });
});

const probe = await probeGpu();
afterAll(() => probe.backend?.destroy());

describe.skipIf(!probe.backend)(`WebGPU memory (${probe.reason})`, () => {
  it("live bytes stay flat across synchronous steps", () => {
    const gpu = probe.backend!;
    const step = setup(gpu);
    step();
    step();
    const after2 = gpu.stats().liveBytes;
    for (let i = 0; i < 20; i++) step();
    expect(gpu.stats().liveBytes).toBe(after2);
  });
});
