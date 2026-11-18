"""`torch.Tensor`: a thin handle to an engine tensor. The values never enter the Python heap
until a readback (`item`, `tolist`, `numpy`) asks for them.

Lifetime: each Tensor owns one id and releases it in `__del__`; the engine frees the storage
at the next collection point once no Tensor and no pending autograd graph needs it (see
`torch.memory_stats`). A training loop therefore holds a flat amount of GPU memory.
"""

from numbers import Number

from . import _bridge as b
from ._bridge import index, js, unsupported
from ._tensor_io import TensorIO
from ._types import device as _device
from ._types import from_engine


def _prod(shape):
    n = 1
    for d in shape:
        n *= d
    return n


def _dims(dim):
    if dim is None:
        return None
    try:
        return index(dim)
    except TypeError:
        return b.ints(dim)


def _size_args(args):
    """`view(2, 3)` and `view((2, 3))` alike (numpy ints accepted)."""
    if len(args) == 1:
        try:
            return (index(args[0]),)
        except TypeError:
            return tuple(index(d) for d in args[0])
    return tuple(index(d) for d in args)


class _GradFn:
    __slots__ = ()

    def __repr__(self):
        return "<engine grad_fn>"


class Tensor(TensorIO):
    __slots__ = ("_id", "_meta", "__weakref__")

    def __init__(self, *args, **kwargs):
        raise TypeError("construct tensors with torch.tensor(...), torch.zeros(...), torch.randn(...)")

    @classmethod
    def _wrap(cls, tensor_id):
        t = object.__new__(cls)
        t._id = tensor_id
        t._meta = None
        return t

    @staticmethod
    def _plain(tensor_id):
        return Tensor._wrap(tensor_id)

    def __del__(self):
        try:
            js.release(self._id)
        except Exception:  # interpreter teardown
            pass

    def __getattr__(self, name):
        if name.startswith("__") or name in Tensor.__slots__:
            raise AttributeError(name)
        raise unsupported(f"torch.Tensor.{name}")

    # ── metadata ─────────────────────────────────────────────────────────────
    def _m(self):
        if self._meta is None:
            dt, shape, dev = js.meta(self._id).split("|")
            self._meta = (from_engine(dt), tuple(int(d) for d in shape.split(",")) if shape else (), _device(dev))
        return self._meta

    @property
    def dtype(self):
        return self._m()[0]

    @property
    def shape(self):
        return self._m()[1]

    @property
    def device(self):
        return self._m()[2]

    @property
    def ndim(self):
        return len(self.shape)

    def dim(self):
        return len(self.shape)

    def size(self, dim=None):
        return self.shape if dim is None else self.shape[index(dim)]

    def numel(self):
        return _prod(self.shape)

    def __len__(self):
        if not self.shape:
            raise TypeError("len() of a 0-d tensor")
        return self.shape[0]

    def is_floating_point(self):
        return self.dtype.is_floating_point

    # ── autograd state ───────────────────────────────────────────────────────
    @property
    def requires_grad(self):
        return bool(js.requires_grad(self._id))

    @requires_grad.setter
    def requires_grad(self, flag):
        js.set_requires_grad(self._id, bool(flag))

    def requires_grad_(self, requires_grad=True):
        self.requires_grad = requires_grad
        return self

    @property
    def is_leaf(self):
        return bool(js.is_leaf(self._id))

    @property
    def grad_fn(self):
        return None if self.is_leaf else _GradFn()

    @property
    def grad(self):
        g = js.grad(self._id)
        return None if g is None else Tensor._wrap(g)

    @grad.setter
    def grad(self, value):
        if value is None:
            js.zero_grad(b.ints([self._id]), True)
        elif isinstance(value, Tensor):
            js.set_grad(self._id, value._id)
        else:
            raise TypeError(f"assigned grad expected to be a Tensor or None but got {type(value).__name__}")

    @property
    def _version(self):
        """In-place writes to this tensor's storage so far, through any view (PyTorch's `_version`)."""
        return int(js.version(self._id))

    def backward(self, gradient=None, retain_graph=None, create_graph=False):
        if create_graph:
            raise unsupported("backward(create_graph=True)", "higher-order gradients are not recorded")
        js.backward(self._id, None if gradient is None else gradient._id, bool(retain_graph))

    def detach(self):
        return Tensor._wrap(js.op("detach", self._id))

    def clone(self):
        return Tensor._wrap(js.op("clone", self._id))

    def __float__(self):
        return float(self.item())

    def __int__(self):
        return int(self.item())

    def __index__(self):
        if self.dtype.is_floating_point or self.numel() != 1:
            raise TypeError("only integer tensors of a single element can be converted to an index")
        return int(self.item())

    def __bool__(self):
        if self.numel() != 1:
            raise RuntimeError("Boolean value of Tensor with more than one value is ambiguous")
        return bool(self.item())

    def __repr__(self):
        try:
            body = repr(self.tolist())
        except RuntimeError:
            body = f"<shape={list(self.shape)}>"
        suffix = ", requires_grad=True" if self.requires_grad else ""
        dev = "" if self.device.type == "cpu" else f", device='{self.device}'"
        return f"tensor({body}{dev}{suffix})"

    # ── arithmetic ───────────────────────────────────────────────────────────
    def _binary(self, name, other, scalar):
        if isinstance(other, Tensor):
            return Tensor._wrap(js.op(name, self._id, other._id))
        if isinstance(other, Number) and not isinstance(other, complex):
            return scalar(float(other))
        return NotImplemented

    def _affine(self, scale, shift=0.0):
        return Tensor._wrap(js.op("affine", self._id, scale, shift))

    def __add__(self, other):
        return self._binary("add", other, lambda s: self._affine(1.0, s))

    __radd__ = __add__

    def __sub__(self, other):
        return self._binary("sub", other, lambda s: self._affine(1.0, -s))

    def __rsub__(self, other):
        return self._binary("sub", other, lambda s: self._affine(-1.0, s))

    def __mul__(self, other):
        return self._binary("mul", other, lambda s: self._affine(s))

    __rmul__ = __mul__

    def __truediv__(self, other):
        return self._binary("div", other, lambda s: self._affine(1.0 / s))

    def __rtruediv__(self, other):
        return self._binary("div", other, lambda s: Tensor._wrap(js.op("rdiv", s, self._id)))

    def __neg__(self):
        return self._affine(-1.0)

    def __pow__(self, exponent):
        if exponent == 2:
            return self * self
        if exponent == 1:
            return self.clone()
        raise unsupported(f"Tensor.__pow__ (exponent {exponent!r})", "only ** 2 is in the surface")

    def __matmul__(self, other):
        return Tensor._wrap(js.op("matmul", self._id, other._id))

    def __eq__(self, other):
        raise unsupported("Tensor.__eq__ (elementwise comparison)")

    __hash__ = object.__hash__

    def __getitem__(self, idx):
        raise unsupported("Tensor.__getitem__ (indexing / slicing)")

    def __setitem__(self, idx, value):
        raise unsupported("Tensor.__setitem__ (in-place indexed assignment)")

    def add(self, other):
        return self + other

    def sub(self, other):
        return self - other

    def mul(self, other):
        return self * other

    def div(self, other):
        return self / other

    def matmul(self, other):
        return self @ other

    # ── shape ────────────────────────────────────────────────────────────────
    def reshape(self, *shape):
        return Tensor._wrap(js.op("reshape", self._id, b.ints(_size_args(shape))))

    view = reshape

    def flatten(self, start_dim=0, end_dim=-1):
        shape = self.shape
        if not shape:
            return self.reshape(1)
        s, e = index(start_dim) % len(shape), index(end_dim) % len(shape)
        return self.reshape(shape[:s] + (_prod(shape[s : e + 1]),) + shape[e + 1 :])

    def unsqueeze(self, dim):
        dim = index(dim)
        shape = list(self.shape)
        shape.insert(dim if dim >= 0 else len(shape) + 1 + dim, 1)
        return self.reshape(shape)

    def squeeze(self, dim=None):
        shape = self.shape
        if dim is None:
            return self.reshape([d for d in shape if d != 1])
        d = index(dim) % len(shape)
        return self if shape[d] != 1 else self.reshape(shape[:d] + shape[d + 1 :])

    def transpose(self, dim0, dim1):
        return Tensor._wrap(js.op("transpose", self._id, index(dim0), index(dim1)))

    def t(self):
        if self.ndim != 2:
            raise RuntimeError(f"t() expects a 2-D tensor, got {self.ndim}-D")
        return self.transpose(0, 1)

    @property
    def T(self):  # noqa: N802 — PyTorch's name
        if self.ndim < 2:
            return self
        if self.ndim > 2:
            raise unsupported("Tensor.T on a tensor with more than 2 dims", "use transpose(dim0, dim1)")
        return self.transpose(0, 1)

    # ── reductions and activations ───────────────────────────────────────────
    def sum(self, dim=None, keepdim=False):
        return Tensor._wrap(js.op("sum", self._id, _dims(dim), bool(keepdim)))

    def mean(self, dim=None, keepdim=False):
        return Tensor._wrap(js.op("mean", self._id, _dims(dim), bool(keepdim)))

    def softmax(self, dim=-1):
        return Tensor._wrap(js.op("softmax", self._id, index(dim)))

    def log_softmax(self, dim=-1):
        return Tensor._wrap(js.op("log_softmax", self._id, index(dim)))

    def relu(self):
        return Tensor._wrap(js.op("relu", self._id))

    def exp(self):
        return Tensor._wrap(js.op("exp", self._id))

    def log(self):
        return Tensor._wrap(js.op("log", self._id))
