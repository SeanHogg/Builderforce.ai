"""Optimizers over the engine's in-place update kernels (ADAMW_WGSL on WebGPU, its CPU mirror).

One param group. Frozen parameters (requires_grad False when the optimizer is built) are skipped,
as the engine does. `step()` and `zero_grad()` are collection points: graph intermediates of the
step are freed there.
"""

from .. import _bridge as b
from .._bridge import js, unsupported
from .._grad_mode import enable_grad


def _params(params):
    params = list(params)
    if params and isinstance(params[0], dict):
        if len(params) > 1:
            raise unsupported("torch.optim with several param groups", "pass one iterable of parameters")
        group = dict(params[0])
        return list(group.pop("params")), group
    return params, {}


class Optimizer:
    _kind = None

    def __init__(self, params, defaults):
        params, overrides = _params(params)
        if not params:
            raise ValueError("optimizer got an empty parameter list")
        self.defaults = dict(defaults)
        self.param_groups = [{"params": params, **self.defaults, **overrides}]
        self.state = {}
        group = self.param_groups[0]
        self._opt = js.optimizer(self._kind, b.ints([p._id for p in params if p.requires_grad]), *self._engine_args(group))

    def _engine_args(self, group):
        raise NotImplementedError

    def zero_grad(self, set_to_none=True):
        js.zero_grad(b.ints([p._id for p in self.param_groups[0]["params"]]), bool(set_to_none))

    def step(self, closure=None):
        loss = None
        if closure is not None:
            with enable_grad():
                loss = closure()
        js.optimizer_step(self._opt, float(self.param_groups[0]["lr"]))
        return loss

    def state_dict(self):
        raise unsupported("Optimizer.state_dict", "optimizer state lives on the device; checkpoint the model's state_dict")

    def load_state_dict(self, state_dict):
        raise unsupported("Optimizer.load_state_dict")

    def __del__(self):
        try:
            js.optimizer_release(self._opt)
        except Exception:
            pass


class AdamW(Optimizer):
    _kind = "adamw"

    def __init__(self, params, lr=1e-3, betas=(0.9, 0.999), eps=1e-8, weight_decay=1e-2, amsgrad=False, **kwargs):
        if amsgrad or kwargs:
            raise unsupported("AdamW(amsgrad / foreach / fused / ...)")
        super().__init__(params, {"lr": lr, "betas": tuple(betas), "eps": eps, "weight_decay": weight_decay})

    def _engine_args(self, g):
        return float(g["lr"]), float(g["betas"][0]), float(g["betas"][1]), float(g["eps"]), float(g["weight_decay"])


class Adam(AdamW):
    """Adam without weight decay is AdamW with weight_decay=0; coupled L2 decay is not in the surface."""

    def __init__(self, params, lr=1e-3, betas=(0.9, 0.999), eps=1e-8, weight_decay=0, amsgrad=False, **kwargs):
        if weight_decay:
            raise unsupported("Adam(weight_decay != 0)", "use AdamW (decoupled decay)")
        super().__init__(params, lr=lr, betas=betas, eps=eps, weight_decay=0, amsgrad=amsgrad, **kwargs)


class SGD(Optimizer):
    _kind = "sgd"

    def __init__(self, params, lr=1e-3, momentum=0, dampening=0, weight_decay=0, nesterov=False, **kwargs):
        if dampening or nesterov or kwargs:
            raise unsupported("SGD(dampening / nesterov / ...)")
        super().__init__(params, {"lr": lr, "momentum": momentum, "weight_decay": weight_decay})

    def _engine_args(self, g):
        return float(g["lr"]), float(g["momentum"]), float(g["weight_decay"])
