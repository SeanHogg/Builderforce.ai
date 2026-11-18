"""`torch.save` / `torch.load` for state dicts, as safetensors bytes.

Only a mapping of name → Tensor is serialized (a `state_dict()`); pickling arbitrary objects is
outside the surface. `f` is a path or a binary file object. The bytes are standard safetensors
(F32), so an adapter saved here loads in the platform's inference path and in `safetensors`.
"""

import json
import os
from collections import OrderedDict

from . import _bridge as b
from ._bridge import js, unsupported, wait
from ._tensor import Tensor
from ._types import device as _device


def _entries(obj):
    if not hasattr(obj, "items"):
        raise unsupported(f"torch.save of {type(obj).__name__}", "only a state_dict (mapping of name → Tensor) is saved")
    names, ids = [], []
    for name, value in obj.items():
        if not isinstance(value, Tensor):
            raise unsupported(f"torch.save of a {type(value).__name__} entry ({name!r})", "state_dict values must be Tensors")
        names.append(str(name))
        ids.append(value._id)
    return b.to_js(names), b.ints(ids)


def _write(f, data):
    if isinstance(f, (str, os.PathLike)):
        with open(f, "wb") as fh:
            fh.write(data)
    else:
        f.write(data)


def _read(f):
    if isinstance(f, (str, os.PathLike)):
        with open(f, "rb") as fh:
            return fh.read()
    return f.read()


def _state_dict(result):
    out = result.to_py()
    return OrderedDict((name, Tensor._wrap(i)) for name, i in zip(out["names"], out["ids"]))


def _device_of(map_location):
    if map_location is None:
        return None
    if callable(map_location):
        raise unsupported("torch.load(map_location=<callable>)")
    return _device(map_location).type


def save_bytes(obj, metadata=None):
    """safetensors bytes of a state dict; `metadata` (str → str) lands in `__metadata__`."""
    names, ids = _entries(obj)
    meta = json.dumps(metadata or {})
    return wait(lambda: js.save(names, ids, meta), "torch.save").to_bytes()


async def save_bytes_async(obj, metadata=None):
    names, ids = _entries(obj)
    return (await js.save(names, ids, json.dumps(metadata or {}))).to_bytes()


def load_bytes(data, map_location=None):
    device = _device_of(map_location)
    return _state_dict(wait(lambda: js.load(b.to_js(data), device), "torch.load"))


async def load_bytes_async(data, map_location=None):
    return _state_dict(await js.load(b.to_js(data), _device_of(map_location)))


def save(obj, f, **kwargs):
    _write(f, save_bytes(obj))


def load(f, map_location=None, weights_only=True, **kwargs):
    return load_bytes(_read(f), map_location)


async def save_async(obj, f):
    _write(f, await save_bytes_async(obj))


async def load_async(f, map_location=None):
    return await load_bytes_async(_read(f), map_location)
