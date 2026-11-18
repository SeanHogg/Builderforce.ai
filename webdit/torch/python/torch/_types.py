"""`torch.dtype` and `torch.device`.

The engine stores two dtypes: float32, and int32 for indices. `torch.long` /
`torch.int64` are accepted wherever PyTorch expects them (class targets,
token ids) and stored as int32 — values must fit in 32 bits.
"""


class dtype:
    __slots__ = ("name", "engine", "is_floating_point")

    def __init__(self, name, engine, is_floating_point):
        self.name = name
        self.engine = engine
        self.is_floating_point = is_floating_point

    def __repr__(self):
        return f"torch.{self.name}"


float32 = dtype("float32", "float32", True)
int32 = dtype("int32", "int32", False)
int64 = int32
long = int32
# `torch.float` / `torch.int` are bound in torch/__init__.py, which defines no
# functions — binding them here would shadow the builtins for this module's code.

_BY_ENGINE = {"float32": float32, "int32": int32}


def from_engine(name):
    return _BY_ENGINE[name]


def resolve_dtype(value):
    """A torch.dtype (or None) → engine dtype name (or None); anything else is refused by name."""
    from ._bridge import unsupported

    if value is None:
        return None
    if isinstance(value, dtype):
        return value.engine
    raise unsupported(f"dtype={value!r}", "only torch.float32 and integer index tensors (torch.long / torch.int32) exist")


class device:
    """`torch.device('webgpu' | 'cpu')`. `cuda` / `gpu` name the WebGPU device — there is no CUDA in a browser."""

    __slots__ = ("type",)

    def __init__(self, type):  # noqa: A002 — PyTorch's signature
        if isinstance(type, device):
            type = type.type
        base = str(type).split(":")[0].lower()
        self.type = "webgpu" if base in ("webgpu", "cuda", "gpu") else base
        if self.type not in ("webgpu", "cpu"):
            raise RuntimeError(f"Expected one of webgpu, cpu device type at start of device string: {type}")

    def __eq__(self, other):
        try:
            return self.type == device(other).type
        except (RuntimeError, TypeError):
            return False

    def __hash__(self):
        return hash(self.type)

    def __str__(self):
        return self.type

    def __repr__(self):
        return f"device(type='{self.type}')"
