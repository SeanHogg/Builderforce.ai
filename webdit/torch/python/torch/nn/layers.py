"""Layers: Linear, Embedding, LayerNorm, ReLU, GELU, Dropout, Identity, Sequential, ModuleList.

Initialization follows PyTorch (Linear: U(-1/√in, 1/√in) for weight and bias; Embedding: N(0, 1);
LayerNorm: γ = 1, β = 0), drawn from the engine's seeded stream (`torch.manual_seed`).
"""

import math
from collections import OrderedDict

from .. import _creation as c
from .._bridge import unsupported
from . import functional as F
from .module import Module
from .parameter import Parameter


class Linear(Module):
    def __init__(self, in_features, out_features, bias=True, device=None, dtype=None):
        super().__init__()
        c._float_only(dtype, "nn.Linear")
        self.in_features = in_features
        self.out_features = out_features
        bound = 1 / math.sqrt(in_features)
        self.weight = Parameter(c.uniform_((out_features, in_features), -bound, bound, device))
        if bias:
            self.bias = Parameter(c.uniform_((out_features,), -bound, bound, device))
        else:
            self.register_parameter("bias", None)

    def forward(self, input):  # noqa: A002
        return F.linear(input, self.weight, self.bias)

    def extra_repr(self):
        return f"in_features={self.in_features}, out_features={self.out_features}, bias={self.bias is not None}"


class Embedding(Module):
    def __init__(self, num_embeddings, embedding_dim, padding_idx=None, device=None, dtype=None, **kwargs):
        super().__init__()
        if padding_idx is not None or kwargs:
            raise unsupported("nn.Embedding(padding_idx / max_norm / sparse ...)")
        c._float_only(dtype, "nn.Embedding")
        self.num_embeddings = num_embeddings
        self.embedding_dim = embedding_dim
        self.weight = Parameter(c.randn(num_embeddings, embedding_dim, device=device))

    def forward(self, input):  # noqa: A002
        return F.embedding(input, self.weight)

    def extra_repr(self):
        return f"{self.num_embeddings}, {self.embedding_dim}"


class LayerNorm(Module):
    def __init__(self, normalized_shape, eps=1e-5, elementwise_affine=True, bias=True, device=None, dtype=None):
        super().__init__()
        shape = (normalized_shape,) if isinstance(normalized_shape, int) else tuple(normalized_shape)
        self.normalized_shape = shape
        self.eps = eps
        self.elementwise_affine = elementwise_affine
        if elementwise_affine:
            self.weight = Parameter(c.ones(shape, device=device))
            self.bias = Parameter(c.zeros(shape, device=device)) if bias else None
        else:
            self.weight = None
            self.bias = None

    def forward(self, input):  # noqa: A002
        return F.layer_norm(input, self.normalized_shape, self.weight, self.bias, self.eps)

    def extra_repr(self):
        return f"{self.normalized_shape}, eps={self.eps}, elementwise_affine={self.elementwise_affine}"


class ReLU(Module):
    def __init__(self, inplace=False):
        super().__init__()

    def forward(self, input):  # noqa: A002
        return F.relu(input)


class GELU(Module):
    def __init__(self, approximate="none"):
        super().__init__()
        self.approximate = approximate

    def forward(self, input):  # noqa: A002
        return F.gelu(input, self.approximate)


class Dropout(Module):
    def __init__(self, p=0.5, inplace=False):
        super().__init__()
        self.p = p

    def forward(self, input):  # noqa: A002
        return F.dropout(input, self.p, self.training)


class Identity(Module):
    def forward(self, input):  # noqa: A002
        return input


class Sequential(Module):
    def __init__(self, *args):
        super().__init__()
        if len(args) == 1 and isinstance(args[0], OrderedDict):
            for name, module in args[0].items():
                self.add_module(name, module)
        else:
            for i, module in enumerate(args):
                self.add_module(str(i), module)

    def __getitem__(self, index):
        return list(self._modules.values())[index]

    def __len__(self):
        return len(self._modules)

    def __iter__(self):
        return iter(self._modules.values())

    def forward(self, input):  # noqa: A002
        for module in self._modules.values():
            input = module(input)
        return input


class ModuleDict(Module):
    def __init__(self, modules=None):
        super().__init__()
        for name, module in (modules or {}).items():
            self.add_module(name, module)

    def __getitem__(self, key):
        return self._modules[key]

    def __setitem__(self, key, module):
        self.add_module(key, module)

    def __contains__(self, key):
        return key in self._modules

    def __len__(self):
        return len(self._modules)

    def __iter__(self):
        return iter(self._modules)

    def keys(self):
        return self._modules.keys()

    def items(self):
        return self._modules.items()

    def values(self):
        return self._modules.values()


class ModuleList(Module):
    def __init__(self, modules=None):
        super().__init__()
        for module in modules or []:
            self.append(module)

    def append(self, module):
        self.add_module(str(len(self._modules)), module)
        return self

    def __getitem__(self, index):
        return list(self._modules.values())[index]

    def __len__(self):
        return len(self._modules)

    def __iter__(self):
        return iter(self._modules.values())
