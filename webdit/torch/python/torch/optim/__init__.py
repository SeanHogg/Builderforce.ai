"""`torch.optim` — AdamW, Adam (no weight decay) and SGD. Unlisted names raise naming the optimizer."""

from .._bridge import unsupported
from .optimizer import SGD, Adam, AdamW, Optimizer


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise unsupported(f"torch.optim.{name}")


__all__ = ["SGD", "Adam", "AdamW", "Optimizer"]
