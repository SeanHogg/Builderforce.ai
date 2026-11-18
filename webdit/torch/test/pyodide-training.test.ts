import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * The Python `torch` package end to end: the same fixed 3-class task as
 * training.test.ts, written as an ordinary PyTorch + peft script, trains a
 * LoRA MLP. Loss must fall, the frozen base must not move, and the run must be
 * reproducible under a fixed seed — on the CPU always, on WebGPU when Dawn
 * finds an adapter.
 */

const N = 32;
const X = values(N * 4, 101, -1, 1);
const M = [1, -1, 0.5, -0.5, 1, 1, 0.2, -1, 0.8, -0.6, 0.3, 0.9];
const Y = Array.from({ length: N }, (_, n) => {
  const scores = [0, 1, 2].map((c) => [0, 1, 2, 3].reduce((s, k) => s + X[n * 4 + k]! * M[k * 3 + c]!, 0));
  return scores.indexOf(Math.max(...scores));
});

const SCRIPT = `
import json
import torch
from torch import nn
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model

torch.set_default_device(DEVICE)
torch.manual_seed(20261117)
model = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 3))
model = get_peft_model(model, LoraConfig(r=4, lora_alpha=8, target_modules=["0", "2"]))
trainable = [n for n, p in model.named_parameters() if p.requires_grad]
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=0.05, weight_decay=0.0)
x = torch.tensor(X).reshape(N, 4)
y = torch.tensor(Y, dtype=torch.long)
base = model.base_model.model[0].base_layer.weight
base_before = base.tolist()
losses = []
model.train()
for step in range(40):
    opt.zero_grad()
    loss = F.cross_entropy(model(x), y)
    loss.backward()
    opt.step()
    if step % 5 == 0 or step == 39:
        losses.append(loss.item())
json.dumps({
    "losses": losses,
    "frozen": base.tolist() == base_before,
    "trainable": trainable,
    "device": str(x.device),
})
`;

interface Run {
  losses: number[];
  frozen: boolean;
  trainable: string[];
  device: string;
}

const probe = await probeGpu();
let py: TorchPython;

beforeAll(async () => {
  py = await startTorchPython({ webgpuBackend: probe.backend ?? undefined });
}, 120_000);
afterAll(() => probe.backend?.destroy());

const train = async (device: string): Promise<Run> => JSON.parse(await py.run<string>(SCRIPT, { DEVICE: device, X, Y, N }));

describe("Python torch: LoRA MLP training (CPU)", () => {
  it("reduces loss deterministically, trains only the adapters, leaves the base frozen", async () => {
    const run1 = await train("cpu");
    const run2 = await train("cpu");
    expect(run1.device).toBe("cpu");
    // Hugging Face peft's layout: PeftModel.base_model (LoraModel) .model (the user's model).
    expect(run1.trainable).toEqual([
      "base_model.model.0.lora_A.default.weight",
      "base_model.model.0.lora_B.default.weight",
      "base_model.model.2.lora_A.default.weight",
      "base_model.model.2.lora_B.default.weight",
    ]);
    expect(run1.losses).toEqual(run2.losses);
    expect(run1.losses.at(-1)!).toBeLessThan(run1.losses[0]! * 0.6);
    expect(run1.frozen).toBe(true);
  }, 60_000);
});

describe.skipIf(!probe.backend)(`Python torch: LoRA MLP training (WebGPU; ${probe.reason})`, () => {
  it("reduces loss on the device and tracks the CPU run", async () => {
    const gpuRun = await train("webgpu");
    const cpuRun = await train("cpu");
    expect(gpuRun.device).toBe("webgpu");
    expect(gpuRun.frozen).toBe(true);
    expect(gpuRun.losses.at(-1)!).toBeLessThan(gpuRun.losses[0]! * 0.6);
    gpuRun.losses.forEach((l, i) => expect(Math.abs(l - cpuRun.losses[i]!)).toBeLessThan(1e-3 + 1e-2 * cpuRun.losses[i]!));
  }, 60_000);
});
