"""PyTorch for Pyodide over the @webdit/torch engine (WebGPU when the worker has an adapter, else CPU).

A subset of the PyTorch API: tensors are thin handles to engine tensors (the values stay on the
device), autograd, nn, optim, safetensors save/load and a peft-style LoRA. Anything outside the
surface raises `NotImplementedError` naming the op — never a silent CPU fallback.

Memory rule: a tensor is freed at the first collection point after no Python object and no pending
autograd graph references it. Collection points: `backward()`, `optimizer.step()`, `zero_grad()`,
leaving `no_grad()`, `torch.empty_cache()`, and automatically whenever the number of live engine
tensors doubles. A standard training loop therefore holds flat GPU memory.

Readback (`item()`, `tolist()`, `numpy()`, `save`, `load`, `.to(device)`) blocks through JSPI when
the program runs inside `runPythonAsync`; elsewhere use the awaitables (`item_async()`, …).

This module defines no function except `__getattr__`: it binds `torch.float` / `torch.int` below,
which would shadow the builtins inside any function defined here.
"""

from ._bridge import UnsupportedOperation
from ._bridge import unsupported as _unsupported
from ._creation import arange, as_tensor, full, manual_seed, ones, ones_like, rand, randn, tensor, zeros, zeros_like
from ._grad_mode import enable_grad, inference_mode, is_grad_enabled, no_grad, set_grad_enabled
from ._ops import add, div, exp, flatten, log, log_softmax, matmul, mean, mul, relu, reshape, softmax, sub, sum, transpose
from ._runtime import cuda, empty_cache, get_default_device, is_tensor, memory_stats, set_default_device, webgpu_unavailable_reason
from ._tensor import Tensor
from ._types import device, dtype, float32, int32, int64, long
from .serialization import load, load_async, save, save_async
from . import nn, optim, utils
from .nn import Parameter

__version__ = "0.0.1+webdit"

float = float32  # noqa: A001 — PyTorch's dtype aliases
int = int32  # noqa: A001
webgpu = cuda


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise _unsupported(f"torch.{name}")
