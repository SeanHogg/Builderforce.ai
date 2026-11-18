"""`torch.nn.Module`: parameter / submodule registration, traversal, state dicts, train/eval."""

from collections import OrderedDict, namedtuple

from .. import _bridge as b
from .._bridge import js, unsupported
from .._tensor import Tensor
from .parameter import Parameter

IncompatibleKeys = namedtuple("IncompatibleKeys", ["missing_keys", "unexpected_keys"])


class Module:
    def __init__(self, *args, **kwargs):
        object.__setattr__(self, "_parameters", OrderedDict())
        object.__setattr__(self, "_buffers", OrderedDict())
        object.__setattr__(self, "_modules", OrderedDict())
        object.__setattr__(self, "training", True)

    def forward(self, *args, **kwargs):
        raise NotImplementedError(f'Module [{type(self).__name__}] is missing the required "forward" function')

    def __call__(self, *args, **kwargs):
        return self.forward(*args, **kwargs)

    # ── registration ─────────────────────────────────────────────────────────
    def _registry(self):
        params = self.__dict__.get("_parameters")
        if params is None:
            raise AttributeError("cannot assign parameters or modules before Module.__init__() call")
        return params, self.__dict__["_buffers"], self.__dict__["_modules"]

    def __setattr__(self, name, value):
        if isinstance(value, (Parameter, Module)):
            params, buffers, modules = self._registry()
            for d in (self.__dict__, params, buffers, modules):
                d.pop(name, None)
            (params if isinstance(value, Parameter) else modules)[name] = value
            return
        registry = self.__dict__.get("_parameters")
        if registry is not None:
            params, buffers, modules = self._registry()
            if name in params:
                if value is not None:
                    raise TypeError(f"cannot assign '{type(value).__name__}' as parameter '{name}' (torch.nn.Parameter or None expected)")
                params[name] = None
                return
            if name in buffers:
                buffers[name] = value
                return
            if name in modules:
                if value is not None:
                    raise TypeError(f"cannot assign '{type(value).__name__}' as child module '{name}'")
                modules[name] = None
                return
        object.__setattr__(self, name, value)

    def __getattr__(self, name):
        d = self.__dict__
        for key in ("_parameters", "_buffers", "_modules"):
            registry = d.get(key)
            if registry is not None and name in registry:
                return registry[name]
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    def __delattr__(self, name):
        for key in ("_parameters", "_buffers", "_modules"):
            if name in self.__dict__.get(key, {}):
                del self.__dict__[key][name]
                return
        object.__delattr__(self, name)

    def register_parameter(self, name, param):
        self._registry()[0][name] = param

    def register_buffer(self, name, tensor, persistent=True):
        if not persistent:
            raise unsupported("register_buffer(persistent=False)")
        self._registry()[1][name] = tensor

    def add_module(self, name, module):
        self._registry()[2][name] = module

    register_module = add_module

    # ── traversal ────────────────────────────────────────────────────────────
    def named_modules(self, memo=None, prefix=""):
        memo = set() if memo is None else memo
        if id(self) in memo:
            return
        memo.add(id(self))
        yield prefix, self
        for name, child in self._modules.items():
            if child is not None:
                yield from child.named_modules(memo, f"{prefix}.{name}" if prefix else name)

    def modules(self):
        for _, m in self.named_modules():
            yield m

    def named_children(self):
        for name, child in self._modules.items():
            if child is not None:
                yield name, child

    def children(self):
        for _, child in self.named_children():
            yield child

    def _named(self, key, prefix, recurse, remove_duplicate=True):
        seen = set()
        if not recurse:
            modules = [(prefix, self)]
        elif remove_duplicate:
            modules = self.named_modules(prefix=prefix)
        else:
            modules = self._all_module_paths(prefix)
        for module_prefix, module in modules:
            for name, value in module.__dict__[key].items():
                if value is None or (remove_duplicate and id(value) in seen):
                    continue
                seen.add(id(value))
                yield (f"{module_prefix}.{name}" if module_prefix else name), value

    def _all_module_paths(self, prefix=""):
        """Every (path, module), a shared submodule once per path (tied weights keep all their keys)."""
        yield prefix, self
        for name, child in self._modules.items():
            if child is not None:
                yield from child._all_module_paths(f"{prefix}.{name}" if prefix else name)

    def named_parameters(self, prefix="", recurse=True, remove_duplicate=True):
        return self._named("_parameters", prefix, recurse, remove_duplicate)

    def parameters(self, recurse=True):
        for _, p in self.named_parameters(recurse=recurse):
            yield p

    def named_buffers(self, prefix="", recurse=True, remove_duplicate=True):
        return self._named("_buffers", prefix, recurse, remove_duplicate)

    def buffers(self, recurse=True):
        for _, t in self.named_buffers(recurse=recurse):
            yield t

    def apply(self, fn):
        for child in self.children():
            child.apply(fn)
        fn(self)
        return self

    # ── state ────────────────────────────────────────────────────────────────
    def _state_entries(self, prefix=""):
        """Parameters then buffers, tied tensors under EVERY name (as PyTorch's state_dict)."""
        p = prefix.rstrip(".")
        return list(self.named_parameters(p, remove_duplicate=False)) + list(self.named_buffers(p, remove_duplicate=False))

    def state_dict(self, destination=None, prefix="", keep_vars=False):
        """Detached views that SHARE storage with the parameters (as in PyTorch): snapshot with
        `copy.deepcopy(model.state_dict())`."""
        out = OrderedDict() if destination is None else destination
        for name, t in self._state_entries(prefix):
            out[name] = t if keep_vars else t.detach()
        return out

    def _plan_load(self, state_dict, strict):
        own = OrderedDict(self._state_entries())
        missing = [k for k in own if k not in state_dict]
        unexpected = [k for k in state_dict if k not in own]
        if strict and (missing or unexpected):
            raise RuntimeError(
                f"Error(s) in loading state_dict for {type(self).__name__}: missing keys {missing}, unexpected keys {unexpected}"
            )
        pairs = []
        for name, dst in own.items():
            if name not in state_dict:
                continue
            src = state_dict[name]
            if not isinstance(src, Tensor):
                raise TypeError(f"load_state_dict: {name!r} is a {type(src).__name__}, not a Tensor")
            if tuple(src.shape) != tuple(dst.shape):
                raise RuntimeError(f"size mismatch for {name}: copying a param with shape {tuple(src.shape)}, the current is {tuple(dst.shape)}")
            pairs.append((dst, src if src.dtype is dst.dtype else src._cast(dst.dtype)))
        return pairs, IncompatibleKeys(missing, unexpected)

    def load_state_dict(self, state_dict, strict=True, assign=False):
        """Copies IN PLACE (bit-exact; an optimizer holding the parameters keeps working)."""
        if assign:
            raise unsupported("load_state_dict(assign=True)")
        pairs, result = self._plan_load(state_dict, strict)
        for dst, src in pairs:
            js.copy_into(dst._id, src.to(dst.device)._id)
        return result

    async def load_state_dict_async(self, state_dict, strict=True):
        """`load_state_dict` for hosts without JSPI: a cross-device source is moved with an await."""
        pairs, result = self._plan_load(state_dict, strict)
        for dst, src in pairs:
            js.copy_into(dst._id, (await src.to_async(dst.device))._id)
        return result

    def train(self, mode=True):
        object.__setattr__(self, "training", bool(mode))
        for child in self.children():
            child.train(mode)
        return self

    def eval(self):
        return self.train(False)

    def requires_grad_(self, requires_grad=True):
        for p in self.parameters():
            p.requires_grad_(requires_grad)
        return self

    def zero_grad(self, set_to_none=True):
        ids = [p._id for p in self.parameters()]
        if ids:
            js.zero_grad(b.ints(ids), bool(set_to_none))

    def _registries(self):
        for module in self.modules():
            for registry in (module._parameters, module._buffers):
                for name, t in list(registry.items()):
                    if t is not None:
                        yield registry, name, t

    @staticmethod
    def _place(registry, name, t, moved, memo):
        """Install the moved tensor; a tied tensor moves once and stays tied (`memo`)."""
        if moved is not t:
            moved = Parameter(moved, t.requires_grad) if isinstance(t, Parameter) else moved
            registry[name] = moved
        memo[id(t)] = registry[name]

    def to(self, *args, **kwargs):
        memo = {}
        for registry, name, t in list(self._registries()):
            if id(t) in memo:
                registry[name] = memo[id(t)]
            else:
                self._place(registry, name, t, t.to(*args, **kwargs), memo)
        return self

    async def to_async(self, *args, **kwargs):
        """`to(device)` for hosts without JSPI."""
        memo = {}
        for registry, name, t in list(self._registries()):
            if id(t) in memo:
                registry[name] = memo[id(t)]
            else:
                self._place(registry, name, t, await t.to_async(*args, **kwargs), memo)
        return self

    def cpu(self):
        return self.to("cpu")

    def cuda(self, device=None):
        return self.to("webgpu")

    def extra_repr(self):
        return ""

    def __repr__(self):
        lines = [f"  ({name}): " + repr(child).replace("\n", "\n  ") for name, child in self.named_children()]
        head = f"{type(self).__name__}({self.extra_repr()}"
        return head + ("\n" + "\n".join(lines) + "\n)" if lines else ")")
