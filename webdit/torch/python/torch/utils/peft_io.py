"""Adapter files in Hugging Face peft's format, and the platform browser trainer's.

- `get_peft_model_state_dict(model)`: only the adapter weights, keys with the adapter name
  stripped — `base_model.model.<path>.lora_A.weight` / `.lora_B.weight` — which is what peft
  writes to `adapter_model.safetensors` and what `exportLoRASafetensors` in the web trainer emits.
- `set_peft_model_state_dict(model, sd, strict=True)`: the inverse; strict refuses a file whose
  adapter keys do not match the model's exactly (missing or unexpected), naming them.
- `save_pretrained(model, dir)` / `from_pretrained(model, dir)`: `adapter_model.safetensors` +
  `adapter_config.json`, with peft's `__metadata__` (`format=pt`).
"""

import json
import os
from collections import OrderedDict

from ..serialization import load_bytes, load_bytes_async, save_bytes, save_bytes_async
from .peft import DEFAULT_ADAPTER, LoraConfig, PeftModel

WEIGHTS_NAME = "adapter_model.safetensors"
CONFIG_NAME = "adapter_config.json"


def _is_adapter_key(key):
    return ".lora_A." in key or ".lora_B." in key


def _strip(key, adapter_name):
    return key.replace(f".lora_A.{adapter_name}.", ".lora_A.").replace(f".lora_B.{adapter_name}.", ".lora_B.")


def _insert(key, adapter_name):
    return key.replace(".lora_A.", f".lora_A.{adapter_name}.").replace(".lora_B.", f".lora_B.{adapter_name}.")


def get_peft_model_state_dict(model, state_dict=None, adapter_name=DEFAULT_ADAPTER):
    full = model.state_dict() if state_dict is None else state_dict
    marker_a, marker_b = f".lora_A.{adapter_name}.", f".lora_B.{adapter_name}."
    return OrderedDict((_strip(k, adapter_name), v) for k, v in full.items() if marker_a in k or marker_b in k)


def set_peft_model_state_dict(model, peft_model_state_dict, adapter_name=DEFAULT_ADAPTER, strict=True):
    expected = {k for k in model.state_dict() if f".lora_A.{adapter_name}." in k or f".lora_B.{adapter_name}." in k}
    mapped = OrderedDict((_insert(k, adapter_name), v) for k, v in peft_model_state_dict.items() if _is_adapter_key(k))
    missing = sorted(expected - set(mapped))
    unexpected = sorted(set(mapped) - expected) + sorted(k for k in peft_model_state_dict if not _is_adapter_key(k))
    if strict and (missing or unexpected):
        raise RuntimeError(f"Error(s) in loading the adapter: missing keys {missing}, unexpected keys {unexpected}")
    model.load_state_dict(OrderedDict((k, v) for k, v in mapped.items() if k in expected), strict=False)
    return missing, unexpected


def _config_of(model):
    if not isinstance(model, PeftModel):
        raise TypeError("save_pretrained expects a PeftModel (from get_peft_model)")
    return model.peft_config[model.active_adapter]


def _metadata(config):
    return {"format": "pt", "peft_type": "LORA", "producer": "@webdit/torch", "rank": str(config.r), "alpha": str(config.lora_alpha)}


def _write_config(save_directory, config):
    with open(os.path.join(save_directory, CONFIG_NAME), "w") as fh:
        json.dump(config.to_dict(), fh, indent=2)


def save_pretrained(model, save_directory, **kwargs):
    config = _config_of(model)
    os.makedirs(save_directory, exist_ok=True)
    data = save_bytes(get_peft_model_state_dict(model, adapter_name=model.active_adapter), _metadata(config))
    with open(os.path.join(save_directory, WEIGHTS_NAME), "wb") as fh:
        fh.write(data)
    _write_config(save_directory, config)


async def save_pretrained_async(model, save_directory, **kwargs):
    config = _config_of(model)
    os.makedirs(save_directory, exist_ok=True)
    data = await save_bytes_async(get_peft_model_state_dict(model, adapter_name=model.active_adapter), _metadata(config))
    with open(os.path.join(save_directory, WEIGHTS_NAME), "wb") as fh:
        fh.write(data)
    _write_config(save_directory, config)


def _read_adapter(model_id):
    with open(os.path.join(model_id, CONFIG_NAME)) as fh:
        config = LoraConfig.from_dict(json.load(fh))
    with open(os.path.join(model_id, WEIGHTS_NAME), "rb") as fh:
        data = fh.read()
    return config, data


def _finish(peft, state, adapter_name, is_trainable):
    set_peft_model_state_dict(peft, state, adapter_name=adapter_name, strict=True)
    if not is_trainable:
        peft.requires_grad_(False)
    return peft


def from_pretrained(model, model_id, adapter_name=DEFAULT_ADAPTER, is_trainable=False, **kwargs):
    """Wrap `model` with the adapter saved in directory `model_id` (strict key match)."""
    config, data = _read_adapter(model_id)
    peft = PeftModel(model, config, adapter_name)
    device = next(iter(peft.parameters())).device
    return _finish(peft, load_bytes(data, device), adapter_name, is_trainable)


async def from_pretrained_async(model, model_id, adapter_name=DEFAULT_ADAPTER, is_trainable=False):
    config, data = _read_adapter(model_id)
    peft = PeftModel(model, config, adapter_name)
    device = next(iter(peft.parameters())).device
    return _finish(peft, await load_bytes_async(data, device), adapter_name, is_trainable)
