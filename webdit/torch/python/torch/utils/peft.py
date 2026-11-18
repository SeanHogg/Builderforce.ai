"""A peft-style LoRA: `LoraConfig` + `get_peft_model(model, config)`, laid out like Hugging Face peft.

`get_peft_model` returns `PeftModel(base_model=LoraModel(model=<your model>))`. Each target
`nn.Linear` becomes a `LoRALinear` holding the original layer (frozen) as `base_layer` plus
`lora_A` / `lora_B` as `ModuleDict({"default": Linear(bias=False)})`. So the full state dict keys
are peft's — `base_model.model.<path>.base_layer.weight`, `base_model.model.<path>.lora_A.default.weight`
— and the adapter-only export (`torch.utils.peft_io`) strips `.default` exactly as peft and the
platform's browser trainer do: `base_model.model.<path>.lora_A.weight`.

Init is peft's: lora_A ~ U(-1/√in, 1/√in) (kaiming-uniform, a=√5), lora_B = 0, so the wrapped
model starts out identical. Every other parameter is frozen: only the adapters train. The forward
merges W + (alpha / r) · B A in ONE engine op (the LoRA WGSL kernels on WebGPU).

Target matching follows peft: a list matches a module whose name equals an entry or ends with
`.entry`; a string is a regex that must match the whole module name.
"""

import re
from dataclasses import asdict, dataclass

from .._bridge import unsupported
from .._grad_mode import no_grad
from ..nn import functional as F
from ..nn.layers import Linear, ModuleDict
from ..nn.module import Module

DEFAULT_ADAPTER = "default"


@dataclass
class LoraConfig:
    r: int = 8
    lora_alpha: int = 8
    target_modules: object = None
    lora_dropout: float = 0.0
    bias: str = "none"
    task_type: object = None
    modules_to_save: object = None
    fan_in_fan_out: bool = False
    init_lora_weights: bool = True
    inference_mode: bool = False
    base_model_name_or_path: object = None

    def __post_init__(self):
        if not isinstance(self.r, int) or self.r < 1:
            raise ValueError(f"LoraConfig: r must be a positive int, got {self.r!r}")
        if self.target_modules is None:
            raise ValueError("LoraConfig: target_modules is required (names or a regex of the Linear layers to adapt)")
        if self.lora_dropout:
            raise unsupported("LoraConfig(lora_dropout > 0)", "dropout is not in the surface")
        if self.bias != "none":
            raise unsupported(f"LoraConfig(bias={self.bias!r})", "only bias='none'")
        if self.modules_to_save:
            raise unsupported("LoraConfig(modules_to_save=...)")
        if self.fan_in_fan_out or self.init_lora_weights is not True:
            raise unsupported("LoraConfig(fan_in_fan_out / init_lora_weights variants)")

    def to_dict(self):
        """peft's adapter_config.json fields."""
        out = asdict(self)
        out["peft_type"] = "LORA"
        if isinstance(out["target_modules"], (list, tuple, set)):
            out["target_modules"] = sorted(out["target_modules"])
        return out

    @classmethod
    def from_dict(cls, data):
        known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        unknown_active = {k: v for k, v in data.items() if k not in known and k not in _IGNORED_CONFIG_KEYS and v not in (None, False, [], {}, "", 0)}
        if unknown_active:
            raise unsupported(f"LoraConfig fields {sorted(unknown_active)}", "this adapter uses peft options outside the surface")
        return cls(**known)


# peft writes these; they carry no behaviour the surface needs to honour.
_IGNORED_CONFIG_KEYS = {"peft_type", "revision", "auto_mapping", "layers_to_transform", "layers_pattern", "rank_pattern", "alpha_pattern", "megatron_config", "megatron_core", "loftq_config", "use_rslora", "use_dora", "layer_replication", "exclude_modules", "eva_config", "lora_bias"}


class LoRALinear(Module):
    """peft's `lora.Linear`: `base_layer` frozen, `lora_A[adapter]` [r, in], `lora_B[adapter]` [out, r]."""

    def __init__(self, base_layer, r, lora_alpha, adapter_name=DEFAULT_ADAPTER):
        super().__init__()
        if not isinstance(base_layer, Linear):
            raise unsupported(f"LoRA on {type(base_layer).__name__}", "only nn.Linear layers are adapted")
        self.base_layer = base_layer
        base_layer.requires_grad_(False)
        dev = base_layer.weight.device
        a = Linear(base_layer.in_features, r, bias=False, device=dev)  # U(-1/√in, 1/√in): peft's init
        b = Linear(r, base_layer.out_features, bias=False, device=dev)
        with no_grad():
            b.weight.zero_()
        self.lora_A = ModuleDict({adapter_name: a})
        self.lora_B = ModuleDict({adapter_name: b})
        self.r = {adapter_name: r}
        self.lora_alpha = {adapter_name: lora_alpha}
        self.scaling = {adapter_name: lora_alpha / r}
        self.active_adapter = adapter_name

    @property
    def in_features(self):
        return self.base_layer.in_features

    @property
    def out_features(self):
        return self.base_layer.out_features

    def forward(self, input):  # noqa: A002
        name = self.active_adapter
        merged = F.lora_merge(self.base_layer.weight, self.lora_A[name].weight, self.lora_B[name].weight, self.scaling[name])
        return F.linear(input, merged, self.base_layer.bias)

    def extra_repr(self):
        return f"r={self.r[self.active_adapter]}, scaling={self.scaling[self.active_adapter]}"


def _matches(name, targets):
    if isinstance(targets, str):
        return re.fullmatch(targets, name) is not None
    return any(name == t or name.endswith("." + t) for t in targets)


class LoraModel(Module):
    """peft's `LoraModel`: the user's model as `.model`, its target Linears replaced in place."""

    def __init__(self, model, config, adapter_name=DEFAULT_ADAPTER):
        super().__init__()
        model.requires_grad_(False)
        targets = [
            (parent, child_name, f"{parent_name}.{child_name}" if parent_name else child_name)
            for parent_name, parent in list(model.named_modules())
            for child_name, _ in list(parent.named_children())
        ]
        adapted = 0
        for parent, child_name, full_name in targets:
            child = parent._modules[child_name]
            if isinstance(child, LoRALinear) or not _matches(full_name, config.target_modules):
                continue
            parent._modules[child_name] = LoRALinear(child, config.r, config.lora_alpha, adapter_name)
            adapted += 1
        if adapted == 0:
            raise ValueError(f"get_peft_model: target_modules {config.target_modules!r} matched no module")
        self.model = model

    def forward(self, *args, **kwargs):
        return self.model(*args, **kwargs)


class PeftModel(Module):
    def __init__(self, model, config, adapter_name=DEFAULT_ADAPTER):
        super().__init__()
        self.base_model = LoraModel(model, config, adapter_name)
        self.peft_config = {adapter_name: config}
        self.active_adapter = adapter_name

    def forward(self, *args, **kwargs):
        return self.base_model(*args, **kwargs)

    def get_base_model(self):
        return self.base_model.model

    def get_nb_trainable_parameters(self):
        trainable = total = 0
        for p in self.parameters():
            n = p.numel()
            total += n
            trainable += n if p.requires_grad else 0
        return trainable, total

    def print_trainable_parameters(self):
        trainable, total = self.get_nb_trainable_parameters()
        print(f"trainable params: {trainable:,} || all params: {total:,} || trainable%: {100 * trainable / max(total, 1):.4f}")

    def save_pretrained(self, save_directory, **kwargs):
        from .peft_io import save_pretrained

        save_pretrained(self, save_directory, **kwargs)

    async def save_pretrained_async(self, save_directory, **kwargs):
        from .peft_io import save_pretrained_async

        await save_pretrained_async(self, save_directory, **kwargs)

    @classmethod
    def from_pretrained(cls, model, model_id, adapter_name=DEFAULT_ADAPTER, is_trainable=False, **kwargs):
        from .peft_io import from_pretrained

        return from_pretrained(model, model_id, adapter_name=adapter_name, is_trainable=is_trainable, **kwargs)

    def merge_and_unload(self):
        raise unsupported("PeftModel.merge_and_unload")


def get_peft_model(model, config, adapter_name=DEFAULT_ADAPTER):
    if not isinstance(model, Module):
        raise TypeError("get_peft_model expects a torch.nn.Module")
    return PeftModel(model, config, adapter_name)
