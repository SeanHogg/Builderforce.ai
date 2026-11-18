import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpu, tensor } from "../src/autograd";
import { counting } from "./helpers/counting-backend";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * A Python training loop holds FLAT memory: across 50 steps the live backend
 * handles (CPU, counted by a wrapper), the bridge's ids / pinned tensors /
 * scope, and — on WebGPU — the pool's live bytes return to the same value
 * after every step. No id, handle or proxy leaks per step.
 */

const LOOP = `
import json
import torch
from torch import nn
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model

torch.set_default_device(DEVICE)
torch.manual_seed(7)
model = nn.Sequential(nn.Linear(6, 12), nn.LayerNorm(12), nn.GELU(), nn.Linear(12, 4))
model = get_peft_model(model, LoraConfig(r=2, lora_alpha=4, target_modules=["0", "3"]))
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=0.01)
x = torch.tensor(X).reshape(8, 6)
y = torch.tensor([0, 3, -100, 1, 2, 2, 3, 0], dtype=torch.long)
samples = []
for step in range(50):
    opt.zero_grad()
    logits = model(x)
    loss = F.cross_entropy(logits, y) + 0.1 * (logits.softmax(-1) * logits.log_softmax(-1)).sum()
    loss.backward()
    opt.step()
    with torch.no_grad():
        probe = model(x).mean()
    if step % 10 == 0:
        loss.item()
    samples.append([LIVE(), torch.memory_stats()])
json.dumps(samples)
`;

const X = values(48, 5);
const probe = await probeGpu();
const counted = counting(cpu);
let py: TorchPython;

beforeAll(async () => {
  py = await startTorchPython({ cpuBackend: counted.backend, webgpuBackend: probe.backend ?? undefined });
}, 120_000);
afterAll(() => probe.backend?.destroy());

type Sample = [number, { ids: number; pinned: number; scoped: number; optimizers: number }];

describe("Python torch: memory stays flat across a training loop", () => {
  it("CPU: live handles, ids, pinned and scoped tensors are constant after warm-up over 50 steps", async () => {
    const samples: Sample[] = JSON.parse(await py.run<string>(LOOP, { DEVICE: "cpu", X, LIVE: counted.live }));
    const [handles2, stats2] = samples[1]!;
    for (const [handles, stats] of samples.slice(2)) {
      expect(handles).toBe(handles2);
      expect(stats).toEqual(stats2);
    }
    expect(stats2.optimizers).toBe(1);
  }, 60_000);

  it("dropping the model and optimizer frees everything the loop made", async () => {
    const before = counted.live();
    const after = await py.run<number>(`
import torch, gc
gc.collect()
torch.empty_cache()
LIVE()
`, { LIVE: counted.live });
    expect(after).toBeLessThan(before);
    const stats = JSON.parse(py.bridge.stats());
    expect(stats).toMatchObject({ ids: 0, pinned: 0, scoped: 0, optimizers: 0 });
  });

  it("tensors the host creates outside bridge calls are never collected by it", async () => {
    const hostTensor = tensor([1, 2, 3], [3], { backend: cpu });
    await py.run(`import torch\nx = torch.ones(4, device="cpu", requires_grad=True)\n(x * 2).sum().backward()\ndel x\ntorch.empty_cache()`);
    expect(hostTensor.isDisposed).toBe(false);
    expect(Array.from(await hostTensor.data())).toEqual([1, 2, 3]);
  });
});

describe.skipIf(!probe.backend)(`Python torch: WebGPU memory (${probe.reason})`, () => {
  it("pool live bytes are constant after warm-up over 50 steps", async () => {
    const gpu = probe.backend!;
    const samples: Sample[] = JSON.parse(await py.run<string>(LOOP, { DEVICE: "webgpu", X, LIVE: () => gpu.stats().liveBytes }));
    const [bytes2] = samples[1]!;
    for (const [bytes] of samples.slice(2)) expect(bytes).toBe(bytes2);
  }, 60_000);
});
