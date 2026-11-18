"""The Tensor methods that move or overwrite values: readback, device and dtype moves, in-place
updates and the copy protocol. Mixed into `torch.Tensor` (see _tensor.py for the handle itself).

In-place rule: `t += x`, `t.copy_(x)`, `t.zero_()`, … write into `t`'s storage through the
engine's bit-exact copy. Allowed on a leaf that does not require grad, or under `no_grad()`
(a manual SGD step); refused by name on a tensor that requires grad while grad mode is on, on a
non-leaf, and on any tensor a pending graph still needs.
"""

from . import _bridge as b
from ._bridge import js, unsupported, wait
from ._grad_mode import is_grad_enabled, no_grad
from ._types import device as _device
from ._types import dtype as _dtype
from ._types import float32, int32


def _nest(flat, shape):
    if not shape:
        return flat[0]
    if len(shape) == 1:
        return list(flat)
    step = 1
    for d in shape[1:]:
        step *= d
    return [_nest(flat[i * step : (i + 1) * step], shape[1:]) for i in range(shape[0])]


class TensorIO:
    __slots__ = ()

    # ── readback ─────────────────────────────────────────────────────────────
    def item(self):
        return wait(lambda: js.item(self._id), "Tensor.item()")

    def tolist(self):
        return _nest(wait(lambda: js.read(self._id), "Tensor.tolist()").to_py().tolist(), self.shape)

    def numpy(self):
        return self._to_numpy(wait(lambda: js.read(self._id), "Tensor.numpy()"))

    async def item_async(self):
        return await js.item(self._id)

    async def tolist_async(self):
        return _nest((await js.read(self._id)).to_py().tolist(), self.shape)

    async def numpy_async(self):
        return self._to_numpy(await js.read(self._id))

    def _to_numpy(self, values):
        try:
            import numpy as np
        except ImportError as error:
            raise RuntimeError("Tensor.numpy() needs numpy (micropip / loadPackage('numpy'))") from error
        kind = np.float32 if self.dtype.is_floating_point else np.int32
        return np.frombuffer(values.to_bytes(), dtype=kind).reshape(self.shape)

    # ── dtype ────────────────────────────────────────────────────────────────
    def _cast(self, target):
        if target is self.dtype:
            return self
        return self._plain(js.op("cast", self._id, target.engine))

    def float(self):
        return self._cast(float32)

    def long(self):
        return self._cast(int32)

    int = long

    def type_as(self, other):
        return self._cast(other.dtype)

    # ── device ───────────────────────────────────────────────────────────────
    def _target(self, args, kwargs):
        """(device or None, dtype or None) from PyTorch's `.to(...)` overloads."""
        target, kind = kwargs.get("device"), kwargs.get("dtype")
        for a in args:
            if isinstance(a, _dtype):
                kind = a
            elif isinstance(a, (str, _device)):
                target = a
            elif hasattr(a, "device") and hasattr(a, "dtype"):  # .to(other_tensor)
                target, kind = a.device, a.dtype
            elif a is not None:
                raise TypeError(f"to() received an invalid argument {a!r}")
        if kwargs.get("non_blocking") or kwargs.get("copy"):
            raise unsupported("Tensor.to(non_blocking / copy)")
        return (None if target is None else _device(target)), kind

    def _check_movable(self):
        if not self.is_leaf and self.requires_grad and is_grad_enabled():
            raise unsupported("Tensor.to(device) on a non-leaf that requires grad", "the device copy is not differentiable; move the leaves")

    def to(self, *args, **kwargs):
        target, kind = self._target(args, kwargs)
        out = self if kind is None else self._cast(kind)
        if target is None or target == out.device:
            return out
        out._check_movable()
        return self._plain(wait(lambda: js.to_device(out._id, target.type), "Tensor.to(device)"))

    async def to_async(self, *args, **kwargs):
        target, kind = self._target(args, kwargs)
        out = self if kind is None else self._cast(kind)
        if target is None or target == out.device:
            return out
        out._check_movable()
        return self._plain(await js.to_device(out._id, target.type))

    def cpu(self):
        return self.to("cpu")

    def cuda(self, device=None):
        return self.to("webgpu")

    # ── in place ─────────────────────────────────────────────────────────────
    def _write(self, name, value):
        if self.requires_grad and is_grad_enabled():
            raise unsupported(f"Tensor.{name} on a tensor that requires grad", "wrap the update in torch.no_grad()")
        if not self.is_leaf:
            raise unsupported(f"Tensor.{name} on a non-leaf tensor")
        if tuple(value.shape) != tuple(self.shape):
            raise RuntimeError(f"{name}: result shape {tuple(value.shape)} does not match the tensor's {tuple(self.shape)}")
        if value.dtype is not self.dtype:
            raise RuntimeError(f"{name}: result dtype {value.dtype} does not match the tensor's {self.dtype}")
        if value.requires_grad and is_grad_enabled():
            raise unsupported(f"Tensor.{name} with an operand that requires grad", "the in-place write is not recorded in the graph")
        js.copy_into(self._id, value.to(self.device)._id)
        return self

    def copy_(self, src, non_blocking=False):
        from ._creation import as_tensor

        src = as_tensor(src, device=self.device)
        if src.dtype is not self.dtype:
            src = src._cast(self.dtype)
        with no_grad():
            if tuple(src.shape) != tuple(self.shape):
                src = src + self._zeros_like()  # broadcast into this shape
            return self._write("copy_", src)

    def _zeros_like(self):
        return self._plain(js.zeros(b.ints(self.shape), self.device.type, False))

    def zero_(self):
        return self.fill_(0.0)

    def fill_(self, value):
        with no_grad():
            if not self.dtype.is_floating_point:
                raise unsupported("Tensor.fill_ on an integer tensor")
            return self._write("fill_", self._plain(js.full(b.ints(self.shape), float(value), self.device.type, False)))

    def _inplace(self, name, other, op):
        result = op(self, other)
        if result is NotImplemented:
            return NotImplemented
        return self._write(name, result)

    def __iadd__(self, other):
        return self._inplace("__iadd__", other, type(self).__add__)

    def __isub__(self, other):
        return self._inplace("__isub__", other, type(self).__sub__)

    def __imul__(self, other):
        return self._inplace("__imul__", other, type(self).__mul__)

    def __itruediv__(self, other):
        return self._inplace("__itruediv__", other, type(self).__truediv__)

    def add_(self, other, alpha=1):
        return self._inplace("add_", other if alpha == 1 else other * alpha, type(self).__add__)

    def sub_(self, other, alpha=1):
        return self._inplace("sub_", other if alpha == 1 else other * alpha, type(self).__sub__)

    def mul_(self, other):
        return self._inplace("mul_", other, type(self).__mul__)

    def div_(self, other):
        return self._inplace("div_", other, type(self).__truediv__)

    # ── copy protocol ────────────────────────────────────────────────────────
    def _rewrap_like(self, fresh):
        """`fresh` as the same class as self (a Parameter stays a Parameter)."""
        if type(self) is not type(fresh):
            return type(self)(fresh, self.requires_grad)
        if self.requires_grad and self.is_leaf:
            fresh.requires_grad_(True)
        return fresh

    def __deepcopy__(self, memo):
        if id(self) in memo:
            return memo[id(self)]
        with no_grad():
            fresh = self._plain(js.op("clone", self._id))
        out = self._rewrap_like(fresh)
        memo[id(self)] = out
        return out

    def __copy__(self):
        return self._rewrap_like(self._plain(js.op("detach", self._id)))

    def __reduce_ex__(self, protocol):
        raise unsupported("pickling a Tensor", "tensors live on the device; use torch.save(state_dict) (safetensors)")
