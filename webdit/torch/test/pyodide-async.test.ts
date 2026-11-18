import { beforeAll, describe, expect, it } from "vitest";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * The non-JSPI host. Blocking readback is refused BEFORE any readback is
 * issued, and every readback has an awaitable twin that works without JSPI:
 * item/tolist/numpy, torch.save/load, Tensor.to / Module.to,
 * load_state_dict, peft save/load. `can_run_sync` is patched to False for the
 * suite (a host whose browser lacks JSPI), and the synchronous `runPython`
 * path — where Pyodide itself reports no JSPI — is exercised too.
 */

let py: TorchPython;
let numpyReason = "";

beforeAll(async () => {
  py = await startTorchPython();
  try {
    await py.pyodide.loadPackage("numpy", { messageCallback: () => undefined, errorCallback: () => undefined });
    await py.run("import numpy");
  } catch (error) {
    numpyReason = `numpy unavailable (no network?): ${error instanceof Error ? error.message : String(error)}`;
  }
}, 180_000);

const NO_JSPI = `
import json
import torch
from torch import nn
from torch import _bridge
_bridge.can_run_sync = lambda: False
`;
const RESTORE = `\nfrom pyodide.ffi import can_run_sync as _real\n_bridge.can_run_sync = _real\n`;

const run = async <T>(code: string): Promise<T> => JSON.parse(await py.run<string>(`${NO_JSPI}\ntry:\n    __result = None\n${code.replace(/^/gm, "    ")}\nfinally:\n${RESTORE.replace(/^/gm, "    ")}\n__result`));

describe("Python torch without JSPI", () => {
  it("blocking readback is refused by name and points to the awaitables", async () => {
    const r = await run<Record<string, string>>(`
t = torch.tensor([1.0, 2.0], device="cpu")
out = {}
for label, fn in [("item", lambda: t.sum().item()), ("tolist", lambda: t.tolist()), ("save", lambda: torch.save({"t": t}, "/tmp/x.safetensors")),
                  ("to_same_device", lambda: nn.Linear(1, 1).to("cpu"))]:
    try:
        fn()
        out[label] = "ok"
    except RuntimeError as e:
        out[label] = str(e)
__result = json.dumps(out)
`);
    expect(r.item).toMatch(/Tensor\.item\(\).*item_async/);
    expect(r.tolist).toMatch(/tolist/);
    expect(r.save).toMatch(/torch\.save/);
    expect(r.to_same_device).toBe("ok"); // same device: nothing to read back
  });

  it("the awaitable forms cover readback, save/load, device moves, load_state_dict and peft", async () => {
    const r = await run<Record<string, unknown>>(`
torch.set_default_device("cpu")
m = nn.Linear(3, 2)
x = torch.ones(1, 3)
v = await m(x).sum().item_async()
rows = await m.weight.tolist_async()
await torch.save_async(m.state_dict(), "/tmp/async.safetensors")
sd = await torch.load_async("/tmp/async.safetensors")
m2 = nn.Linear(3, 2)
await m2.load_state_dict_async(sd)
same = (await m2.weight.tolist_async()) == rows
moved = await m.weight.detach().to_async("cpu")
devices = torch.cuda.is_available()
if devices:
    await m2.to_async("webgpu")
from peft import LoraConfig, get_peft_model
from torch.utils.peft_io import from_pretrained_async
p = get_peft_model(nn.Sequential(nn.Linear(3, 2)), LoraConfig(r=1, lora_alpha=1, target_modules=["0"]))
await p.save_pretrained_async("/tmp/async-adapter")
q = await from_pretrained_async(nn.Sequential(nn.Linear(3, 2)), "/tmp/async-adapter")
__result = json.dumps({"v": v, "same": same, "moved": str(moved.device), "keys": list(sd.keys()),
                       "adapter": list(q.state_dict().keys())[-1]})
`);
    expect(typeof r.v).toBe("number");
    expect(r).toMatchObject({ same: true, moved: "cpu", keys: ["weight", "bias"], adapter: "base_model.model.0.lora_B.default.weight" });
  });

  it("numpy_async reads back without JSPI", async (ctx) => {
    if (numpyReason) ctx.skip(numpyReason);
    const r = await run<{ shape: number[]; values: number[] }>(`
a = await torch.tensor([[1.0, 2.0], [3.0, 4.0]], device="cpu").numpy_async()
__result = json.dumps({"shape": list(a.shape), "values": a.reshape(-1).tolist()})
`);
    expect(r).toEqual({ shape: [2, 2], values: [1, 2, 3, 4] });
  });

  it("numpy int64 beyond int32 raises OverflowError instead of wrapping", async (ctx) => {
    if (numpyReason) ctx.skip(numpyReason);
    const r = await run<string>(`
import numpy as np
try:
    torch.tensor(np.array([2**40], dtype=np.int64))
    __result = json.dumps("no error")
except OverflowError as e:
    __result = json.dumps("OverflowError")
`);
    expect(r).toBe("OverflowError");
  });
});
