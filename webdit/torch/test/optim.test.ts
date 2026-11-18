import { describe, expect, it } from "vitest";
import { F, intTensor, manualSeed, nn, optim, tensor } from "../src/autograd";

/** Optimizer arithmetic against hand-computed updates, and module plumbing. */

describe("optimizers (CPU reference)", () => {
  it("AdamW: one step matches the closed form and leaves the gradient intact", async () => {
    const w = tensor([1, -2], [2], { requiresGrad: true });
    F.sum(F.mul(w, tensor([0.5, 4], [2]))).backward(); // grad = [0.5, 4]
    new optim.AdamW([w], { lr: 0.1, weightDecay: 0.01, eps: 1e-8 }).step();
    // Step 1: m̂ = g, v̂ = g², so the Adam term is g/|g| = ±1 (minus eps).
    const expected = [1 - 0.1 * (1 + 0.01 * 1), -2 - 0.1 * (1 + 0.01 * -2)];
    const got = await w.data();
    expected.forEach((e, i) => expect(got[i]).toBeCloseTo(e, 5));
    expect(Array.from(await w.grad!.data())).toEqual([0.5, 4]);
  });

  it("AdamW bias correction counts each parameter's own steps", async () => {
    const a = tensor([0], [1], { requiresGrad: true });
    const b = tensor([0], [1], { requiresGrad: true });
    const opt = new optim.AdamW([a, b], { lr: 0.1, weightDecay: 0 });
    F.sum(F.affine(a, 3)).backward(); // step 1: only `a` has a gradient
    opt.step();
    opt.zeroGrad();
    F.sum(F.add(F.affine(a, 3), F.affine(b, 3))).backward(); // step 2: both do
    opt.step();
    // `b`'s first update is a step-1 update (m̂ = g, v̂ = g² ⇒ exactly -lr), not a
    // step-2 correction of a zero history (which would give ≈ -0.0744).
    expect(await b.item()).toBeCloseTo(-0.1, 5);
    expect(await a.item()).toBeCloseTo(-0.2, 4);
  });

  it("SGD with momentum: two steps", async () => {
    const w = tensor([1], [1], { requiresGrad: true });
    const opt = new optim.SGD([w], { lr: 0.1, momentum: 0.9 });
    for (let i = 0; i < 2; i++) {
      opt.zeroGrad();
      F.sum(F.affine(w, 2)).backward(); // grad = 2
      opt.step();
    }
    // buf1 = 2, w1 = 0.8 ; buf2 = 0.9·2 + 2 = 3.8, w2 = 0.8 - 0.38 = 0.42
    expect(await w.item()).toBeCloseTo(0.42, 6);
  });

  it("optimizers skip frozen parameters", () => {
    manualSeed(3);
    const lora = new nn.LoRALinear(4, 3, { rank: 2 });
    const names = [...lora.namedParameters()].map(([n]) => n);
    expect(names).toEqual(["lora_A", "lora_B", "base.weight", "base.bias"]);
    expect(lora.trainableParameters()).toHaveLength(2);
    expect(new optim.AdamW(lora.parameters()).params).toHaveLength(2);
  });

  it("LoRALinear starts equal to its base (B = 0) and scales by alpha / rank", async () => {
    manualSeed(4);
    const base = new nn.Linear(3, 2);
    const lora = nn.LoRALinear.fromLinear(base, { rank: 2, alpha: 8 });
    expect(lora.scale).toBe(4);
    const x = tensor([1, 2, 3], [1, 3]);
    expect(Array.from(await lora.forward(x).data())).toEqual(Array.from(await base.forward(x).data()));
  });

  it("modules: Sequential, LayerNorm and Embedding forward shapes", () => {
    manualSeed(5);
    const emb = new nn.Embedding(10, 4);
    const ln = new nn.LayerNorm(4);
    const mlp = new nn.Sequential(new nn.Linear(4, 8), new nn.Lambda(F.gelu), new nn.Linear(8, 2));
    const h = emb.forward(intTensor([1, 2, 3, 4, 5, 6], [2, 3]));
    expect(mlp.forward(ln.forward(h)).shape).toEqual([2, 3, 2]);
    expect(mlp.parameters()).toHaveLength(4);
  });
});
