import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { F, cpu, intTensor, tensor, type DeviceTensor } from "../src/autograd";
import { probeGpu } from "./helpers/gpu";
import { values } from "./helpers/op-cases";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * The Python surface against the engine it drives: gradients equal the JS
 * engine's for the same graph, `no_grad` records nothing, `ignore_index`
 * drops targets, unsupported ops raise NotImplementedError naming the op,
 * state dicts round-trip through safetensors, and both readback bridges
 * (JSPI `item()` and the `item_async()` awaitable) work.
 */

const probe = await probeGpu();
let py: TorchPython;

beforeAll(async () => {
  py = await startTorchPython({ webgpuBackend: probe.backend ?? undefined });
}, 120_000);
afterAll(() => probe.backend?.destroy());

const json = async <T>(code: string, globals: Record<string, unknown> = {}): Promise<T> =>
  JSON.parse(await py.run<string>(`import json\nimport torch\nimport torch.nn.functional as F\nfrom torch import nn\n${code}`, globals));

const A = values(12, 7, -1, 1);
const W = values(20, 8, -1, 1);
const BIAS = values(5, 9, -0.5, 0.5);
const G = values(5, 10, 0.5, 1.5);
const BETA = values(5, 11, -0.2, 0.2);

/** The graph, written once against the JS engine… */
async function jsGraph(): Promise<Record<string, number[]>> {
  const o = { backend: cpu, requiresGrad: true };
  const a = tensor(A, [3, 4], o);
  const w = tensor(W, [4, 5], o);
  const bias = tensor(BIAS, [5], o);
  const g = tensor(G, [5], o);
  const beta = tensor(BETA, [5], o);
  const h = F.gelu(F.add(F.matmul(a, w), bias), "none"); // PyTorch's default: the exact erf GELU
  const s = F.logSoftmax(h);
  const ln = F.layerNorm(h, g, beta, 1e-5);
  const q = F.softmax(F.transpose(h, 0, 1));
  const term1 = F.mean(F.mul(s, ln));
  const term2 = F.mulScalar(F.sum(F.div(q, F.addScalar(q, 1))), 0.5);
  const term3 = F.sum(F.mean(F.mulScalar(F.exp(h), 0.1), 0));
  F.sub(F.add(term1, term2), term3).backward();
  const grad = async (t: DeviceTensor) => Array.from(await t.grad!.data());
  return { a: await grad(a), w: await grad(w), bias: await grad(bias), g: await grad(g), beta: await grad(beta) };
}

/** …and in Python. */
const PY_GRAPH = `
torch.set_default_device(DEVICE)
a = torch.tensor(A).reshape(3, 4).detach().requires_grad_()
w = torch.tensor(W).reshape(4, 5).detach().requires_grad_()
bias = torch.tensor(BIAS, requires_grad=True)
g = torch.tensor(G, requires_grad=True)
beta = torch.tensor(BETA, requires_grad=True)
h = F.gelu(a @ w + bias)
s = F.log_softmax(h, -1)
ln = F.layer_norm(h, (5,), g, beta)
q = h.T.softmax(-1)
loss = (s * ln).mean() + 0.5 * (q / (q + 1.0)).sum() - (h.exp() * 0.1).mean(dim=0).sum()
loss.backward()
flat = lambda t: t.grad.reshape(-1).tolist()
json.dumps({"a": flat(a), "w": flat(w), "bias": flat(bias), "g": flat(g), "beta": flat(beta)})
`;

describe("Python torch semantics", () => {
  it("gradients equal the JS engine's for the same graph (CPU)", async () => {
    const expected = await jsGraph();
    const got = await json<Record<string, number[]>>(PY_GRAPH, { DEVICE: "cpu", A, W, BIAS, G, BETA });
    for (const key of Object.keys(expected)) {
      expect(got[key]!.length).toBe(expected[key]!.length);
      got[key]!.forEach((v, i) => expect(v).toBeCloseTo(expected[key]![i]!, 6));
    }
  });

  it.skipIf(!probe.backend)("gradients on WebGPU track the CPU reference", async () => {
    const expected = await jsGraph();
    const got = await json<Record<string, number[]>>(PY_GRAPH, { DEVICE: "webgpu", A, W, BIAS, G, BETA });
    for (const key of Object.keys(expected)) got[key]!.forEach((v, i) => expect(Math.abs(v - expected[key]![i]!)).toBeLessThan(1e-4));
  });

  it("no_grad blocks graph recording (context manager and decorator)", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device("cpu")
x = torch.ones(3, requires_grad=True)
with torch.no_grad():
    y = x * 2
    inside = torch.is_grad_enabled()
@torch.no_grad()
def infer(t):
    return (t * 3).sum()
z = infer(x)
w = x * 2
try:
    y.sum().backward()
    err = None
except Exception as e:
    err = str(e)
json.dumps({"y": y.requires_grad, "y_leaf": y.grad_fn is None, "inside": inside, "z": z.requires_grad,
            "w": w.requires_grad, "after": torch.is_grad_enabled(), "err": err})
`);
    expect(r).toMatchObject({ y: false, y_leaf: true, inside: false, z: false, w: true, after: true });
    expect(String(r.err)).toMatch(/does not require grad/);
  });

  it("cross_entropy(ignore_index=-100) matches the engine: ignored rows add no loss and no gradient", async () => {
    const logits = values(12, 21, -2, 2);
    const targets = [0, -100, 2, -100];
    const ref = tensor(logits, [4, 3], { backend: cpu, requiresGrad: true });
    const refLoss = F.crossEntropy(ref, intTensor(targets, [4], { backend: cpu }));
    refLoss.backward();
    const r = await json<{ loss: number; module: number; grad: number[][] }>(`
torch.set_default_device("cpu")
x = torch.tensor(L).reshape(4, 3).detach().requires_grad_()
t = torch.tensor(T, dtype=torch.long)
loss = F.cross_entropy(x, t, ignore_index=-100)
loss.backward()
json.dumps({"loss": loss.item(), "module": nn.CrossEntropyLoss(ignore_index=-100)(x, t).item(), "grad": x.grad.tolist()})
`, { L: logits, T: targets });
    expect(r.loss).toBeCloseTo(await refLoss.item(), 6);
    expect(r.module).toBeCloseTo(r.loss, 6);
    expect(r.grad[1]).toEqual([0, 0, 0]);
    expect(r.grad[3]).toEqual([0, 0, 0]);
    const refGrad = Array.from(await ref.grad!.data());
    r.grad.flat().forEach((v, i) => expect(v).toBeCloseTo(refGrad[i]!, 6));
  });

  it("unsupported ops raise NotImplementedError naming the op", async () => {
    const r = await json<Array<[string, boolean, string]>>(`
x = torch.ones(2, 2, device="cpu")
out = []
for label, fn in [
    ("Tensor.sigmoid", lambda: x.sigmoid()),
    ("torch.fft", lambda: torch.fft),
    ("nn.Conv2d", lambda: nn.Conv2d),
    ("F.silu", lambda: F.silu(x)),
    ("__getitem__", lambda: x[0]),
    ("optim.RMSprop", lambda: torch.optim.RMSprop),
    ("pow", lambda: x ** 3),
]:
    try:
        fn()
        out.append([label, False, "no error"])
    except NotImplementedError as e:
        out.append([label, True, str(e)])
json.dumps(out)
`);
    for (const [label, raised, message] of r) {
      expect(raised, `${label}: ${message}`).toBe(true);
      expect(message).toContain(label.split(".").at(-1)!);
      expect(message).toContain("@webdit/torch");
    }
    expect(await py.run(`import torch\nhasattr(torch, "fft")`)).toBe(false);
  });

  it("state_dict saves to safetensors and loads back exactly, in place", async () => {
    const r = await json<Record<string, unknown>>(`
torch.set_default_device("cpu")
torch.manual_seed(1)
a = nn.Sequential(nn.Linear(4, 8), nn.GELU(), nn.LayerNorm(8), nn.Linear(8, 2))
torch.manual_seed(2)
b = nn.Sequential(nn.Linear(4, 8), nn.GELU(), nn.LayerNorm(8), nn.Linear(8, 2))
differs = a.state_dict()["0.weight"].tolist() != b.state_dict()["0.weight"].tolist()
torch.save(a.state_dict(), "/tmp/a.safetensors")
held = b[0].weight.detach()  # a view of the parameter's storage, taken BEFORE the load
opt = torch.optim.SGD(b.parameters(), lr=0.1)
result = b.load_state_dict(torch.load("/tmp/a.safetensors"))
same = all(a.state_dict()[k].tolist() == v.tolist() for k, v in b.state_dict().items())
held_loaded = held.tolist() == a[0].weight.tolist()  # the load wrote into the same storage
with open("/tmp/a.safetensors", "rb") as fh:
    head = fh.read(8)
x = torch.randn(3, 4)
b(x).sum().backward()
opt.step()
stepped = b[0].weight.tolist()
in_place = held_loaded and held.tolist() == stepped and stepped != a[0].weight.tolist()  # the optimizer kept updating it
json.dumps({"differs": differs, "same": same, "in_place": in_place,
            "missing": result.missing_keys, "unexpected": result.unexpected_keys,
            "header_len": int.from_bytes(head, "little"), "keys": list(torch.load("/tmp/a.safetensors").keys())})
`);
    expect(r).toMatchObject({ differs: true, same: true, in_place: true, missing: [], unexpected: [] });
    expect(r.keys).toEqual(["0.weight", "0.bias", "2.weight", "2.bias", "3.weight", "3.bias"]);
    expect(r.header_len as number).toBeGreaterThan(0);
  });

  it("readback: item() blocks through JSPI in runPythonAsync; without it item_async() is the awaitable", async () => {
    expect(await py.run(`import torch\ntorch.tensor([1.5, 2.5], device="cpu").sum().item()`)).toBe(4);
    expect(await py.run(`import torch\nawait torch.tensor([[1, 2], [3, 4]], device="cpu").tolist_async()`)).toEqual([[1, 2], [3, 4]]);
    // runPython is not a promising call: can_run_sync() is False there — the real non-JSPI path.
    expect(() => py.runSync(`import torch\ntorch.tensor([1.0], device="cpu").item()`)).toThrow(/item_async/);
  });

  it("int32 operands are refused by name for float kernels; .float() / .long() cast, CPU and WebGPU agree", async () => {
    const devices = probe.backend ? ["cpu", "webgpu"] : ["cpu"];
    const results = [];
    for (const device of devices) {
      results.push(
        await json<Record<string, unknown>>(`
torch.set_default_device(DEVICE)
i = torch.tensor([[1, -2, 3], [4, 5, -6]])
errors = []
for label, fn in [("add", lambda: i + i), ("mul", lambda: i * 2.0), ("sum", lambda: i.sum()), ("matmul", lambda: i @ i.T),
                  ("softmax", lambda: i.softmax(-1)), ("relu", lambda: F.relu(i))]:
    try:
        fn()
        errors.append([label, "no error"])
    except Exception as e:
        errors.append([label, str(e)])
f = i.float()
back = (f * 1.5).long()
json.dumps({"errors": errors, "float": (f * 0.5).tolist(), "long": back.tolist(), "dtype": str(back.dtype),
            "t": i.T.tolist(), "same": f.float() is f})
`, { DEVICE: device }),
      );
    }
    for (const r of results) {
      for (const [label, message] of r.errors as Array<[string, string]>) {
        expect(message, label).toMatch(/float32/);
      }
      expect(r.float).toEqual([[0.5, -1, 1.5], [2, 2.5, -3]]);
      expect(r.long).toEqual([[1, -3, 4], [6, 7, -9]]); // truncation toward zero, as PyTorch
      expect(r.dtype).toBe("torch.int32");
      expect(r.t).toEqual([[1, 4], [-2, 5], [3, -6]]);
      expect(r.same).toBe(true);
    }
    if (results.length === 2) expect(results[1]).toEqual(results[0]);
  });

  it("gelu: approximate='none' is the exact erf GELU, 'tanh' the approximation (CPU and WebGPU)", async () => {
    for (const device of probe.backend ? ["cpu", "webgpu"] : ["cpu"]) {
      const r = await json<{ exact: number[]; tanh: number[] }>(`
x = torch.tensor([-3.0, -1.0, -0.5, 0.0, 0.5, 1.0, 3.0], device=DEVICE)
json.dumps({"exact": F.gelu(x).tolist(), "tanh": F.gelu(x, approximate="tanh").tolist()})
`, { DEVICE: device });
      const xs = [-3, -1, -0.5, 0, 0.5, 1, 3];
      // Reference erf GELU values (PyTorch, float64 rounded).
      const exact = [-0.0040496, -0.1586553, -0.1542687, 0, 0.3457313, 0.8413447, 2.9959504];
      r.exact.forEach((v, k) => expect(Math.abs(v - exact[k]!), `x=${xs[k]}`).toBeLessThan(2e-6));
      expect(Math.abs(r.tanh[1]! - -0.1588080)).toBeLessThan(2e-6);
    }
  });

  it("numpy-free dims accept any index-like int; numpy int64 out of int32 range raises OverflowError", async () => {
    const r = await json<Record<string, unknown>>(`
class I:
    def __init__(self, v): self.v = v
    def __index__(self): return self.v
x = torch.ones(2, 3, device="cpu")
try:
    torch.tensor([2**40], dtype=torch.long)
    overflow = "no error"
except OverflowError as e:
    overflow = "OverflowError"
json.dumps({"sum": x.sum(I(1)).tolist(), "t": list(x.transpose(I(0), I(1)).shape), "view": list(x.view(I(3), I(2)).shape),
            "overflow": overflow})
`);
    expect(r).toEqual({ sum: [3, 3], t: [3, 2], view: [3, 2], overflow: "OverflowError" });
  });
});
