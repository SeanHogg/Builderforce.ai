"""`torch.nn` — modules over the @webdit/torch engine. Unlisted names raise naming the module."""

from .._bridge import unsupported
from . import functional
from .layers import GELU, Dropout, Embedding, Identity, LayerNorm, Linear, ModuleDict, ModuleList, ReLU, Sequential
from .module import Module
from .parameter import Parameter


class CrossEntropyLoss(Module):
    def __init__(self, ignore_index=-100, reduction="mean", **kwargs):
        super().__init__()
        self.ignore_index = ignore_index
        self.reduction = reduction
        self._kwargs = kwargs

    def forward(self, input, target):  # noqa: A002
        return functional.cross_entropy(input, target, ignore_index=self.ignore_index, reduction=self.reduction, **self._kwargs)


class MSELoss(Module):
    def __init__(self, reduction="mean"):
        super().__init__()
        self.reduction = reduction

    def forward(self, input, target):  # noqa: A002
        return functional.mse_loss(input, target, self.reduction)


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise unsupported(f"torch.nn.{name}")


__all__ = [
    "CrossEntropyLoss",
    "Dropout",
    "Embedding",
    "GELU",
    "Identity",
    "LayerNorm",
    "Linear",
    "MSELoss",
    "Module",
    "ModuleDict",
    "ModuleList",
    "Parameter",
    "ReLU",
    "Sequential",
    "functional",
]
