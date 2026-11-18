"""`torch.utils` — the peft-style LoRA helpers (`torch.utils.peft`, `torch.utils.peft_io`; also importable as `peft`)."""

from .._bridge import unsupported
from . import peft, peft_io


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise unsupported(f"torch.utils.{name}")
