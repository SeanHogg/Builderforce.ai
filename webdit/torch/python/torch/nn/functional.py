"""`torch.nn.functional`: the engine's differentiable ops. Anything else raises naming the op."""

from .._bridge import js, unsupported
from .._tensor import Tensor


def _op(name, *args):
    return Tensor._wrap(js.op(name, *args))


def _id(t):
    return None if t is None else t._id


def linear(input, weight, bias=None):  # noqa: A002 — PyTorch's signature
    return _op("linear", input._id, weight._id, _id(bias))


def relu(input, inplace=False):  # noqa: A002
    return _op("relu", input._id)


def gelu(input, approximate="none"):  # noqa: A002
    """`approximate="none"` (PyTorch's default) is the exact erf GELU; `"tanh"` the tanh approximation."""
    if approximate not in ("none", "tanh"):
        raise ValueError(f"gelu: approximate must be 'none' or 'tanh', got {approximate!r}")
    return _op("gelu", input._id, approximate)


def softmax(input, dim=-1, dtype=None):  # noqa: A002
    return input.softmax(-1 if dim is None else dim)


def log_softmax(input, dim=-1, dtype=None):  # noqa: A002
    return input.log_softmax(-1 if dim is None else dim)


def layer_norm(input, normalized_shape, weight=None, bias=None, eps=1e-5):  # noqa: A002
    shape = (normalized_shape,) if isinstance(normalized_shape, int) else tuple(normalized_shape)
    if len(shape) != 1 or shape[0] != input.shape[-1]:
        raise unsupported(f"layer_norm(normalized_shape={shape})", "only the last dim is normalized")
    return _op("layer_norm", input._id, _id(weight), _id(bias), float(eps))


def embedding(input, weight, padding_idx=None, max_norm=None, norm_type=2.0, scale_grad_by_freq=False, sparse=False):  # noqa: A002
    if padding_idx is not None or max_norm is not None or scale_grad_by_freq or sparse:
        raise unsupported("embedding(padding_idx / max_norm / scale_grad_by_freq / sparse)")
    return _op("embedding", input._id, weight._id)


def cross_entropy(input, target, weight=None, size_average=None, ignore_index=-100, reduce=None, reduction="mean", label_smoothing=0.0):  # noqa: A002
    if weight is not None:
        raise unsupported("cross_entropy(weight=...)", "class weights are not in the surface")
    if label_smoothing:
        raise unsupported("cross_entropy(label_smoothing=...)")
    if size_average is not None or reduce is not None:
        raise unsupported("cross_entropy(size_average / reduce)", "use reduction=")
    return _op("cross_entropy", input._id, target._id, reduction, int(ignore_index))


def mse_loss(input, target, reduction="mean"):  # noqa: A002
    diff = input - target
    sq = diff * diff
    if reduction == "mean":
        return sq.mean()
    if reduction == "sum":
        return sq.sum()
    if reduction == "none":
        return sq
    raise ValueError(f"{reduction} is not a valid value for reduction")


def dropout(input, p=0.5, training=True, inplace=False):  # noqa: A002
    if not training or p == 0:
        return input
    raise unsupported("dropout (p > 0 while training)", "set p=0 or call model.eval()")


def lora_merge(base, lora_a, lora_b, scale):
    """base + scale · (B @ A) as ONE op (the engine's LoRA kernels on WebGPU)."""
    return _op("lora_merge", base._id, lora_a._id, lora_b._id, float(scale))


def __getattr__(name):
    if name.startswith("__"):
        raise AttributeError(name)
    raise unsupported(f"torch.nn.functional.{name}")
