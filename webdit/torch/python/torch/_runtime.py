"""Device and memory probes: `torch.cuda.is_available()`, default device, `memory_stats()`, `empty_cache()`.

`cuda` names the WebGPU device in this runtime (there is no CUDA in a browser), so code written
for `torch.cuda.is_available()` / `.to("cuda")` runs on WebGPU unchanged.
"""

import json

from ._bridge import js
from ._types import device


class cuda:  # noqa: N801 — PyTorch's namespace
    @staticmethod
    def is_available():
        return "webgpu" in js.devices().split(",")

    @staticmethod
    def device_count():
        return 1 if cuda.is_available() else 0

    @staticmethod
    def empty_cache():
        return js.collect()


def get_default_device():
    return device(js.default_device())


def set_default_device(name):
    js.set_default_device(device(name).type)


def memory_stats():
    """Live engine tensors: `ids` Python holds, distinct `pinned` tensors, `scoped` tensors the
    collector tracks (pinned + graph-reachable + not yet collected), live `optimizers`."""
    return json.loads(js.stats())


def empty_cache():
    """Run the collector now; returns how many tensors it freed."""
    return js.collect()


def webgpu_unavailable_reason():
    return js.webgpu_unavailable_reason()


def is_tensor(obj):
    from ._tensor import Tensor

    return isinstance(obj, Tensor)
