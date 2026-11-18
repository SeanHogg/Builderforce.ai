"""Grad mode: `torch.no_grad()` / `enable_grad()` / `set_grad_enabled()` / `inference_mode()`.

Each works as a context manager and as a decorator — with or without parentheses
(`@torch.no_grad` and `@torch.no_grad()`), on plain functions, generators (the mode is set
around every resume, as PyTorch does) and coroutines (the mode spans the awaited body). The
switch is the engine's own (ops record no graph while it is off); leaving `no_grad` is also a
collection point.
"""

import functools
import inspect

from ._bridge import js


def is_grad_enabled():
    return bool(js.is_grad_enabled())


class _Mode:
    """Sets grad mode to `target()` for its extent; restores the previous mode on exit."""

    def __init__(self, mode):
        self.mode = bool(mode)
        self._previous = []

    def target(self):
        return self.mode

    def __enter__(self):
        self._previous.append(bool(js.set_grad_enabled(self.target())))
        return self

    def __exit__(self, *exc):
        js.set_grad_enabled(self._previous.pop())
        return False

    def clone(self):
        return _Mode(self.mode)

    def __call__(self, fn):
        return _decorate(fn, self.clone)


def _decorate(fn, make):
    """Wrap `fn` so each call runs under a fresh context from `make()`."""
    if inspect.iscoroutinefunction(fn):

        @functools.wraps(fn)
        async def coroutine(*args, **kwargs):
            with make():
                return await fn(*args, **kwargs)

        return coroutine

    if inspect.isgeneratorfunction(fn):

        @functools.wraps(fn)
        def generator(*args, **kwargs):
            gen = fn(*args, **kwargs)
            try:
                with make():
                    response = gen.send(None)
                while True:
                    try:
                        request = yield response
                    except GeneratorExit:
                        with make():
                            gen.close()
                        raise
                    except BaseException as error:  # noqa: BLE001 — forwarded into the generator
                        with make():
                            response = gen.throw(error)
                    else:
                        with make():
                            response = gen.send(request)
            except StopIteration as stop:
                return stop.value

        return generator

    @functools.wraps(fn)
    def plain(*args, **kwargs):
        with make():
            return fn(*args, **kwargs)

    return plain


class _BareDecoratable(_Mode):
    """`@torch.no_grad` (no parentheses) decorates directly; `torch.no_grad()` is the context."""

    _MODE = True

    def __new__(cls, orig_func=None):
        if orig_func is not None:
            if not callable(orig_func):
                raise TypeError(f"{cls.__name__}() takes no arguments")
            return _decorate(orig_func, cls)
        return super().__new__(cls)

    def __init__(self, orig_func=None):
        super().__init__(self._MODE)

    def clone(self):
        return type(self)()


class no_grad(_BareDecoratable):  # noqa: N801 — PyTorch's name
    _MODE = False


class enable_grad(_BareDecoratable):  # noqa: N801
    _MODE = True


class inference_mode(_Mode):  # noqa: N801
    """`inference_mode()` / `inference_mode(True)` disables grad; `inference_mode(False)` leaves the mode as it is."""

    def __new__(cls, mode=True):
        if callable(mode):
            return _decorate(mode, cls)
        return super().__new__(cls)

    def __init__(self, mode=True):
        super().__init__(False)
        self.inference = bool(mode)

    def target(self):
        return False if self.inference else is_grad_enabled()

    def clone(self):
        return inference_mode(self.inference)


class set_grad_enabled(_Mode):  # noqa: N801
    """Called as a function it flips the mode at once (PyTorch); as a context it restores on exit;
    as a decorator it undoes that immediate flip and applies the mode per call instead."""

    def __init__(self, mode):
        super().__init__(mode)
        self._previous.append(bool(js.set_grad_enabled(self.mode)))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if self._previous:
            js.set_grad_enabled(self._previous.pop())
        return False

    def __call__(self, fn):
        if self._previous:
            js.set_grad_enabled(self._previous.pop())
        mode = self.mode
        return _decorate(fn, lambda: _Mode(mode))
