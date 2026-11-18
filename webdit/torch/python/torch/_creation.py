"""Tensor constructors: torch.tensor / zeros / ones / full / randn / rand / arange / manual_seed.

Buffers (numpy arrays, `array.array`, memoryviews) cross to the engine as one typed-array copy;
nested lists are packed once in C (`array.array`) — never element by element over the FFI.
"""

import math
from numbers import Number

from . import _bridge as b
from ._bridge import js, unsupported
from ._tensor import Tensor, _size_args
from ._types import device as _device
from ._types import int32, resolve_dtype


def _dev(device):
    return None if device is None else _device(device).type


def _numpy_source(data, engine_dtype):
    import numpy as np

    arr = np.asarray(data)
    integer = engine_dtype == "int32" if engine_dtype else arr.dtype.kind in "iub"
    if integer and arr.size and arr.dtype.kind in "iuf":
        lo, hi = arr.min(), arr.max()
        if lo < -(2**31) or hi > 2**31 - 1:
            # The list path's array.array('i') raises the same; never wrap silently.
            raise OverflowError(f"torch.tensor: integer values [{lo}, {hi}] do not fit in int32 (index tensors are stored as int32)")
    arr = np.ascontiguousarray(arr, dtype=np.int32 if integer else np.float32)
    return b.buffer_of(arr, integer), tuple(arr.shape), integer


def tensor(data, dtype=None, device=None, requires_grad=False):
    engine_dtype = resolve_dtype(dtype)
    if isinstance(data, Tensor):
        out = data.detach()
        if requires_grad:
            out.requires_grad_(True)
        return out
    if hasattr(data, "__array_interface__"):
        buf, shape, integer = _numpy_source(data, engine_dtype)
    elif isinstance(data, (memoryview, bytes, bytearray)) or type(data).__name__ == "array":
        mv = memoryview(data)
        integer = engine_dtype == "int32" if engine_dtype else mv.format not in ("f", "d", "e")
        buf, shape = b.buffer_of(mv, integer), tuple(mv.shape)
    else:
        flat, shape = b.flatten(data)
        if any(isinstance(v, complex) for v in flat):
            raise unsupported("complex tensors")
        integer = engine_dtype == "int32" if engine_dtype else all(isinstance(v, (bool, int)) for v in flat) and bool(flat)
        buf = b.list_buffer([int(v) for v in flat] if integer else flat, integer)
    if integer and requires_grad:
        raise RuntimeError("Only Tensors of floating point dtype can require gradients")
    return Tensor._wrap(js.from_buffer(buf, b.ints(shape), _dev(device), bool(requires_grad)))


def as_tensor(data, dtype=None, device=None):
    return data if isinstance(data, Tensor) else tensor(data, dtype=dtype, device=device)


def _float_only(dtype, name):
    engine = resolve_dtype(dtype)
    if engine not in (None, "float32"):
        raise unsupported(f"torch.{name}(dtype={dtype!r})", "only float32 is generated on the device")


def zeros(*size, dtype=None, device=None, requires_grad=False):
    _float_only(dtype, "zeros")
    return Tensor._wrap(js.zeros(b.ints(_size_args(size)), _dev(device), bool(requires_grad)))


def ones(*size, dtype=None, device=None, requires_grad=False):
    _float_only(dtype, "ones")
    return Tensor._wrap(js.ones(b.ints(_size_args(size)), _dev(device), bool(requires_grad)))


def full(size, fill_value, dtype=None, device=None, requires_grad=False):
    _float_only(dtype, "full")
    return Tensor._wrap(js.full(b.ints(_size_args((size,))), float(fill_value), _dev(device), bool(requires_grad)))


def zeros_like(t, dtype=None, device=None, requires_grad=False):
    return zeros(t.shape, dtype=dtype, device=device or t.device, requires_grad=requires_grad)


def ones_like(t, dtype=None, device=None, requires_grad=False):
    return ones(t.shape, dtype=dtype, device=device or t.device, requires_grad=requires_grad)


def randn(*size, generator=None, dtype=None, device=None, requires_grad=False):
    if generator is not None:
        raise unsupported("torch.randn(generator=...)", "seed the stream with torch.manual_seed")
    _float_only(dtype, "randn")
    return Tensor._wrap(js.randn(b.ints(_size_args(size)), _dev(device), bool(requires_grad)))


def rand(*size, generator=None, dtype=None, device=None, requires_grad=False):
    if generator is not None:
        raise unsupported("torch.rand(generator=...)", "seed the stream with torch.manual_seed")
    _float_only(dtype, "rand")
    return Tensor._wrap(js.uniform(b.ints(_size_args(size)), 0.0, 1.0, _dev(device), bool(requires_grad)))


def uniform_(shape, low, high, device=None, requires_grad=False):
    """A fresh U(low, high) tensor from the seeded stream (layer initialization)."""
    return Tensor._wrap(js.uniform(b.ints(shape), float(low), float(high), _dev(device), bool(requires_grad)))


def arange(start, end=None, step=1, dtype=None, device=None, requires_grad=False):
    if end is None:
        start, end = 0, start
    count = max(0, math.ceil((end - start) / step))
    if dtype is None and all(isinstance(x, int) for x in (start, end, step)):
        dtype = int32
    return tensor([start + i * step for i in range(count)], dtype=dtype, device=device, requires_grad=requires_grad)


def manual_seed(seed):
    if not isinstance(seed, Number):
        raise TypeError("manual_seed expects an int")
    js.manual_seed(int(seed) & 0xFFFFFFFF)
