import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safetensorsToTensors, tensorsToSafetensors } from "@seanhogg/builderforce-memory-engine";
import { startTorchPython, type TorchPython } from "./helpers/pyodide";

/**
 * The peft layout matches Hugging Face peft AND the platform's browser
 * trainer (`exportLoRASafetensors`: `base_model.model.<target>.lora_A.weight`):
 * full keys carry `.default`, the adapter export strips it, `save_pretrained`
 * writes adapter_model.safetensors + adapter_config.json, and an HF-format
 * adapter (written here from JS, as the trainer does) loads with strict key
 * matching.
 */

let py: TorchPython;

beforeAll(async () => {
  py = await startTorchPython();
}, 120_000);
afterAll(() => undefined);

const json = async <T>(code: string, globals: Record<string, unknown> = {}): Promise<T> =>
  JSON.parse(await py.run<string>(`import json, os\nimport torch\nfrom torch import nn\nfrom peft import LoraConfig, PeftModel, get_peft_model, get_peft_model_state_dict, set_peft_model_state_dict\n${code}`, globals));

const MODEL = `
torch.set_default_device("cpu")
torch.manual_seed(11)
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.q_proj = nn.Linear(4, 3)
        self.out = nn.Linear(3, 2)
    def forward(self, x):
        return self.out(self.q_proj(x).relu())
`;

describe("peft layout", () => {
  it("full state_dict keys are peft's; the adapter export strips .default like the web trainer", async () => {
    const r = await json<{ full: string[]; adapter: string[]; config: Record<string, unknown> }>(`${MODEL}
model = get_peft_model(Net(), LoraConfig(r=2, lora_alpha=4, target_modules=["q_proj"]))
model.save_pretrained("/tmp/adapter")
with open("/tmp/adapter/adapter_config.json") as fh:
    config = json.load(fh)
json.dumps({"full": list(model.state_dict().keys()), "adapter": list(get_peft_model_state_dict(model).keys()), "config": config})
`);
    expect(r.full).toEqual([
      "base_model.model.q_proj.base_layer.weight",
      "base_model.model.q_proj.base_layer.bias",
      "base_model.model.q_proj.lora_A.default.weight",
      "base_model.model.q_proj.lora_B.default.weight",
      "base_model.model.out.weight",
      "base_model.model.out.bias",
    ]);
    // The exact names exportLoRASafetensors (frontend/src/lib/webgpu-trainer.ts) writes.
    expect(r.adapter).toEqual(["base_model.model.q_proj.lora_A.weight", "base_model.model.q_proj.lora_B.weight"]);
    expect(r.config).toMatchObject({ peft_type: "LORA", r: 2, lora_alpha: 4, target_modules: ["q_proj"] });
    const file = py.pyodide.FS.readFile("/tmp/adapter/adapter_model.safetensors") as Uint8Array;
    const tensors = safetensorsToTensors(file);
    expect(tensors.map((t) => [t.name, t.shape])).toEqual([
      ["base_model.model.q_proj.lora_A.weight", [2, 4]],
      ["base_model.model.q_proj.lora_B.weight", [3, 2]],
    ]);
  });

  it("an HF-format adapter (written from JS like the trainer's export) loads with strict keys; a mismatch is refused", async () => {
    const A = [0.1, -0.2, 0.3, 0.4, 0.5, 0.6, -0.7, 0.8];
    const B = [1, 2, 3, 4, 5, 6];
    const bytes = tensorsToSafetensors(
      [
        { name: "base_model.model.q_proj.lora_A.weight", shape: [2, 4], data: Float32Array.from(A) },
        { name: "base_model.model.q_proj.lora_B.weight", shape: [3, 2], data: Float32Array.from(B) },
      ],
      { metadata: { format: "pt", peft_type: "LORA" } },
    );
    py.pyodide.FS.mkdirTree("/tmp/hf");
    py.pyodide.FS.writeFile("/tmp/hf/adapter_model.safetensors", bytes);
    py.pyodide.FS.writeFile(
      "/tmp/hf/adapter_config.json",
      JSON.stringify({ peft_type: "LORA", r: 2, lora_alpha: 4, target_modules: ["q_proj"], lora_dropout: 0.0, bias: "none", task_type: null, use_rslora: false }),
    );
    const r = await json<Record<string, unknown>>(`${MODEL}
model = PeftModel.from_pretrained(Net(), "/tmp/hf")
layer = model.base_model.model.q_proj
torch.save({"base_model.model.q_proj.lora_A.weight": torch.zeros(2, 4)}, "/tmp/partial.safetensors")
try:
    set_peft_model_state_dict(model, torch.load("/tmp/partial.safetensors"))
    strict = "no error"
except RuntimeError as e:
    strict = str(e)
json.dumps({"A": layer.lora_A["default"].weight.reshape(-1).tolist(), "B": layer.lora_B["default"].weight.reshape(-1).tolist(),
            "trainable": model.get_nb_trainable_parameters()[0], "strict": strict})
`);
    (r.A as number[]).forEach((v, i) => expect(v).toBeCloseTo(A[i]!, 6));
    expect(r.B).toEqual(B);
    expect(r.trainable).toBe(0); // from_pretrained defaults to inference (is_trainable=False)
    expect(r.strict).toMatch(/missing keys \['base_model\.model\.q_proj\.lora_B\.default\.weight'\]/);
  });

  it("save_pretrained → from_pretrained round-trips a trained adapter", async () => {
    const r = await json<{ same: boolean }>(`${MODEL}
model = get_peft_model(Net(), LoraConfig(r=2, lora_alpha=4, target_modules=["q_proj", "out"]))
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=0.1)
x = torch.randn(5, 4)
for _ in range(3):
    opt.zero_grad()
    model(x).sum().backward()
    opt.step()
model.save_pretrained("/tmp/rt")
torch.manual_seed(11)
loaded = PeftModel.from_pretrained(Net(), "/tmp/rt")
json.dumps({"same": model(x).tolist() == loaded(x).tolist()})
`);
    expect(r.same).toBe(true);
  });
});
