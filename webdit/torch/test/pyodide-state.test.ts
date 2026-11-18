import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeGpu } from "./helpers/gpu";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * Writing state from Python: load_state_dict through the bit-exact in-place
 * copy (aliased sources, NaN destinations), in-place operators (a manual SGD
 * loop), the copy protocol (deepcopy of models and state dicts), `.grad`
 * survival across collection, grad-mode decorators, tied weights,
 * `zero_grad(set_to_none=False)`, `.to(device)` on graphs, and bounded memory
 * in a long no_grad loop. Every case runs on the CPU, and on WebGPU too when
 * Dawn finds an adapter.
 */

const probe = await probeGpu();
const DEVICES = probe.backend ? ["cpu", "webgpu"] : ["cpu"];
let py: TorchPython;

beforeAll(async () => {
  py = await startTorchPython({ webgpuBackend: probe.backend ?? undefined });
}, 120_000);
afterAll(() => probe.backend?.destroy());

const json = async <T>(code: string, globals: Record<string, unknown> = {}): Promise<T> =>
  JSON.parse(await py.run<string>(`import copy, json, math\nimport torch\nimport torch.nn.functional as F\nfrom torch import nn\n${code}`, globals));

describe.each(DEVICES)("Python torch state (%s)", (device) => {
  it("load_state_dict of the model's own (aliased) state_dict is a no-op", async () => {
    const r = await json<{ before: number[][]; after: number[][] }>(`
torch.set_default_device(DEVICE)
torch.manual_seed(3)
m = nn.Linear(3, 2)
before = m.weight.tolist()
m.load_state_dict(m.state_dict())
json.dumps({"before": before, "after": m.weight.tolist()})
`, { DEVICE: device });
    expect(r.after).toEqual(r.before);
  });

  it("early stopping: best = deepcopy(state_dict()) … train … load(best) restores; the aliased form tracks training", async () => {
    const r = await json<Record<string, boolean>>(`
torch.set_default_device(DEVICE)
torch.manual_seed(4)
m = nn.Linear(3, 2)
opt = torch.optim.SGD(m.parameters(), lr=0.5)
best = copy.deepcopy(m.state_dict())
alias = m.state_dict()
snapshot = m.weight.tolist()
for _ in range(3):
    opt.zero_grad()
    (m(torch.ones(4, 3)) ** 2).sum().backward()
    opt.step()
moved = m.weight.tolist() != snapshot
alias_tracks = alias["weight"].tolist() == m.weight.tolist()
best_kept = best["weight"].tolist() == snapshot
m.load_state_dict(best)
json.dumps({"moved": moved, "alias_tracks": alias_tracks, "best_kept": best_kept, "restored": m.weight.tolist() == snapshot})
`, { DEVICE: device });
    expect(r).toEqual({ moved: true, alias_tracks: true, best_kept: true, restored: true });
  });

  it("a destination holding NaN / Inf is restored exactly", async () => {
    const r = await json<{ restored: boolean; had_nan: boolean }>(`
torch.set_default_device(DEVICE)
m = nn.Linear(2, 2)
good = copy.deepcopy(m.state_dict())
with torch.no_grad():
    m.weight.copy_(torch.tensor([[float("nan"), float("inf")], [-float("inf"), 1.0]]))
had_nan = any(math.isnan(v) for row in m.weight.tolist() for v in row)
m.load_state_dict(good)
json.dumps({"had_nan": had_nan, "restored": m.weight.tolist() == good["weight"].tolist()})
`, { DEVICE: device });
    expect(r).toEqual({ had_nan: true, restored: true });
  });

  it("in-place operators: a manual SGD loop under no_grad trains; outside no_grad they are refused by name", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
torch.manual_seed(5)
w = torch.randn(3, 1, requires_grad=True)
x = torch.tensor([[1.0, 2.0, 3.0], [0.5, -1.0, 2.0], [-1.0, 0.0, 1.0], [2.0, 1.0, 0.0]])
y = x @ torch.tensor([[0.5], [-1.0], [2.0]])
first = None
for step in range(60):
    loss = ((x @ w - y) ** 2).mean()
    loss.backward()
    with torch.no_grad():
        w -= 0.05 * w.grad
        w.grad.zero_()
    first = loss.item() if first is None else first
last = loss.item()
try:
    w += 1.0
    refused = "no error"
except NotImplementedError as e:
    refused = str(e)
h = w * 2.0
try:
    with torch.no_grad():
        h += 1.0
    nonleaf = "no error"
except NotImplementedError as e:
    nonleaf = str(e)
z = (w @ torch.ones(1, 2)).sum()
with torch.no_grad():
    w.add_(1.0)  # legal now (as in PyTorch); the pending graph that read w fails at backward
try:
    z.backward()
    pending = "no error"
except Exception as e:
    pending = str(e)
json.dumps({"first": first, "last": last, "refused": refused, "nonleaf": nonleaf, "pending": pending})
`, { DEVICE: device });
    expect(r.last as number).toBeLessThan((r.first as number) * 0.05);
    expect(r.refused).toMatch(/__iadd__.*requires grad/);
    expect(r.nonleaf).toMatch(/__iadd__ on a non-leaf/);
    expect(r.pending).toMatch(/modified by an inplace operation: \[torch\.FloatTensor \[3, 1\]\].* is at version \d+; expected version \d+ instead/);
  });

  it("version counter: a write through a detach()ed view after forward fails backward; optimizer steps between iterations do not", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
w = torch.randn(3, 3, requires_grad=True)
x = torch.randn(2, 3)
alias = w.detach()
v0 = w._version
loss = (x @ w).relu().sum()
with torch.no_grad():
    alias.mul_(2.0)  # same storage as w, different tensor
bumped = w._version == v0 + 1 and alias._version == w._version
try:
    loss.backward()
    detached = "no error"
except Exception as e:
    detached = str(e)
m = nn.Linear(3, 2)
opt = torch.optim.AdamW(m.parameters(), lr=0.01)
for _ in range(4):
    opt.zero_grad()
    m(x).sum().backward()  # a fresh graph each iteration: the previous step's writes are older than it
    opt.step()
json.dumps({"bumped": bumped, "detached": detached, "steps_ok": True, "param_version": m.weight._version})
`, { DEVICE: device });
    expect(r.bumped).toBe(true);
    expect(r.detached).toMatch(/modified by an inplace operation: \[torch\.FloatTensor \[3, 3\]\], which is needed by matmul, is at version 1; expected version 0 instead/);
    expect(r.steps_ok).toBe(true);
    expect(r.param_version as number).toBeGreaterThanOrEqual(4);
  });

  it("deepcopy copies .grad (a clone, not an alias)", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
m = nn.Linear(2, 1)
m(torch.ones(1, 2)).sum().backward()
m2 = copy.deepcopy(m)
with torch.no_grad():
    m.weight.grad.mul_(3.0)
json.dumps({"copied": m2.weight.grad.tolist(), "original": m.weight.grad.tolist(), "none_bias": copy.deepcopy(nn.Linear(1, 1)).bias.grad is None})
`, { DEVICE: device });
    expect(r).toEqual({ copied: [[1, 1]], original: [[3, 3]], none_bias: true });
  });

  it("under no_grad an op's internal intermediates are freed as the call returns", async () => {
    const r = await json<Record<string, number>>(`
torch.set_default_device(DEVICE)
x = torch.randn(256, 256)
w = torch.randn(256, 256)
bias = torch.zeros(256)
with torch.no_grad():
    before = torch.memory_stats()["scopedBytes"]
    y = F.linear(x, w, bias)  # matmul result + bias add: the matmul result is internal
    after = torch.memory_stats()["scopedBytes"]
json.dumps({"delta": after - before, "result": y.numel() * 4})
`, { DEVICE: device });
    expect(r.delta).toBe(r.result);
  });

  it("deepcopy(model) and deepcopy(state_dict()) give independent tensors with fresh ids; pickling is refused", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
m = nn.Sequential(nn.Linear(2, 2), nn.ReLU())
m2 = copy.deepcopy(m)
sd = copy.deepcopy(m.state_dict())
original = m[0].weight.tolist()
with torch.no_grad():
    m2[0].weight.fill_(7.0)
    sd["0.weight"].fill_(9.0)
import pickle
try:
    pickle.dumps(m[0].weight)
    pickled = "no error"
except NotImplementedError as e:
    pickled = str(e)
json.dumps({"untouched": m[0].weight.tolist() == original, "m2": m2[0].weight.tolist(), "sd": sd["0.weight"].tolist(),
            "param": isinstance(m2[0].weight, nn.Parameter), "rg": m2[0].weight.requires_grad,
            "fresh_ids": m2[0].weight._id != m[0].weight._id, "pickled": pickled})
`, { DEVICE: device });
    expect(r).toMatchObject({ untouched: true, param: true, rg: true, fresh_ids: true, m2: [[7, 7], [7, 7]], sd: [[9, 9], [9, 9]] });
    expect(r.pickled).toMatch(/pickling a Tensor/);
  });

  it("a .grad Python still holds survives its owner being collected", async () => {
    const r = await json<{ grad: number[] }>(`
torch.set_default_device(DEVICE)
def sal(d):
    x = torch.ones(3, requires_grad=True)
    (x * d).sum().backward()
    return x.grad
g = sal(2.0)
torch.empty_cache()
json.dumps({"grad": g.tolist()})
`, { DEVICE: device });
    expect(r.grad).toEqual([2, 2, 2]);
  });

  it("zero_grad(set_to_none=False) zeroes in place; tied weights keep every state_dict key", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
m = nn.Linear(2, 2)
m(torch.ones(1, 2)).sum().backward()
held = m.weight.grad
m.zero_grad(set_to_none=False)
class Tied(nn.Module):
    def __init__(self):
        super().__init__()
        self.a = nn.Linear(2, 2, bias=False)
        self.b = nn.Linear(2, 2, bias=False)
        self.b.weight = self.a.weight
t = Tied()
json.dumps({"held": held.tolist(), "still": m.weight.grad.tolist(), "keys": list(t.state_dict().keys()),
            "params": len(list(t.parameters()))})
`, { DEVICE: device });
    expect(r).toEqual({ held: [[0, 0], [0, 0]], still: [[0, 0], [0, 0]], keys: ["a.weight", "b.weight"], params: 1 });
  });

  it(".to(device) on a non-leaf that requires grad is refused; leaves move", async () => {
    const other = device === "cpu" && probe.backend ? "webgpu" : "cpu";
    const r = await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
x = torch.ones(2, requires_grad=True)
y = x * 2
err = "same device"
if OTHER != DEVICE:
    try:
        y.to(OTHER)
        err = "no error"
    except NotImplementedError as e:
        err = str(e)
moved = x.to(OTHER)
json.dumps({"err": err, "leaf": moved.is_leaf, "rg": moved.requires_grad, "device": str(moved.device), "same": y.to(DEVICE) is y})
`, { DEVICE: device, OTHER: other });
    if (other !== device) expect(r.err).toMatch(/non-leaf/);
    expect(r.same).toBe(true);
    expect(r).toMatchObject({ leaf: true, rg: true, device: other });
  });

  it("a long no_grad loop over large tensors stays bounded (freed at release, byte-aware collection)", async () => {
    const r = await json<{ peak: number; end: number }>(`
torch.set_default_device(DEVICE)
w = torch.randn(256, 256)
peak = 0
with torch.no_grad():
    for i in range(200):
        x = torch.randn(16, 256)
        y = (x @ w).relu().sum()
        peak = max(peak, torch.memory_stats()["scopedBytes"])
end = torch.memory_stats()["scopedBytes"]
json.dumps({"peak": peak, "end": end})
`, { DEVICE: device });
    // w (256 KiB) plus one step's 16 KiB tensors — not the ~4 MiB the count-based collector alone would allow.
    expect(r.peak).toBeLessThan(512 * 1024);
  }, 60_000);
});

describe("grad-mode decorators", () => {
  it("bare @no_grad, set_grad_enabled as decorator, inference_mode(False), generators and coroutines", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device("cpu")
x = torch.ones(2, requires_grad=True)
@torch.no_grad
def bare(t):
    return (t * 2).requires_grad
@torch.set_grad_enabled(False)
def off(t):
    return (t * 2).requires_grad
after_decorating = torch.is_grad_enabled()
@torch.inference_mode(False)
def keep_mode(t):
    return (t * 2).requires_grad
@torch.no_grad()
def gen(t):
    for _ in range(2):
        yield (t * 2).requires_grad, torch.is_grad_enabled()
@torch.no_grad()
async def co(t):
    return (t * 2).requires_grad
yielded = list(gen(x))
json.dumps({"bare": bare(x), "off": off(x), "after_decorating": after_decorating, "keep_mode": keep_mode(x),
            "gen": yielded, "between": torch.is_grad_enabled(), "co": await co(x), "end": torch.is_grad_enabled()})
`);
    expect(r).toEqual({
      bare: false,
      off: false,
      after_decorating: true,
      keep_mode: true,
      gen: [[false, false], [false, false]],
      between: true,
      co: false,
      end: true,
    });
  });
});
