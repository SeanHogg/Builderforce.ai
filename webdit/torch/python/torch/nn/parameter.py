"""`torch.nn.Parameter`: a leaf Tensor that requires grad and registers itself on a Module."""

from .._bridge import js
from .._tensor import Tensor


class Parameter(Tensor):
    __slots__ = ()

    def __new__(cls, data=None, requires_grad=True):
        if data is None:
            raise TypeError("Parameter(data) needs a tensor")
        if not isinstance(data, Tensor):
            raise TypeError(f"Parameter(data) needs a torch.Tensor, got {type(data).__name__}")
        # A graph-free view of the same storage (PyTorch also shares the data).
        p = cls._wrap(js.op("detach", data._id))
        if requires_grad:
            p.requires_grad_(True)
        return p

    def __init__(self, data=None, requires_grad=True):
        pass

    def __repr__(self):
        return "Parameter containing:\n" + super().__repr__()
