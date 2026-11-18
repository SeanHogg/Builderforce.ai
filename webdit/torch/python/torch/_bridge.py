"""The one seam to the engine: the JS module `_webdit_torch` (@webdit/torch/pyodide).

Python never holds engine objects. Every Tensor owns one integer id; scalars,
strings and ids cross the FFI as plain values, shapes and dims as JS arrays
(`to_js(list)`), buffers as typed arrays (`to_js(memoryview)`: one copy, no
element loop). No Python object is ever handed to JS to keep, so there is no
PyProxy to leak.

Readback is the only asynchronous call. `wait()` blocks on it through
`pyodide.ffi.run_sync` (JSPI, inside a promising call such as
`runPythonAsync`); without JSPI it raises and points to the `*_async()`
awaitables.
"""

import operator

import _webdit_torch as js
from pyodide.ffi import to_js

try:
    from pyodide.ffi import can_run_sync, run_sync
except ImportError:  # an older Pyodide without JSPI support

    def can_run_sync():
        return False

    def run_sync(awaitable):
        raise RuntimeError("run_sync is unavailable")


class UnsupportedOperation(NotImplementedError, AttributeError):
    """An op outside the @webdit/torch surface. Never a silent CPU fallback."""


def unsupported(name, detail=""):
    message = f"{name} is not supported by the WebGPU torch surface (@webdit/torch)"
    return UnsupportedOperation(f"{message}: {detail}" if detail else message)


def jspi_available():
    """Looked up at call time, so a host (or a test) can patch `can_run_sync`."""
    return bool(can_run_sync())


def wait(start, what):
    """Block on an engine readback (JSPI), or explain the asyncio alternative.

    `start` is a zero-argument callable that issues the readback: it is only called once
    blocking is known to be possible, so a refused readback never leaves a dangling promise.
    """
    if not jspi_available():
        raise RuntimeError(
            f"{what} needs to wait for the GPU, which blocks only through JSPI inside a promising call "
            f"(pyodide.runPythonAsync) — unavailable here. Use the awaitable form instead "
            f"(e.g. `await t.item_async()`, `await t.tolist_async()`, `await torch.save_async(...)`)."
        )
    return run_sync(start())


def index(value):
    """An int from any integer-like value (Python int, numpy integer, 0-d index tensor-free)."""
    return operator.index(value)


def ints(values):
    """A JS array of ints from any Python sequence (no PyProxy crosses)."""
    return to_js([operator.index(v) for v in values])


def flatten(data):
    """Nested Python sequences → (flat list, shape). Ragged input raises ValueError."""
    if isinstance(data, (int, float, bool)):
        return [data], ()
    items = list(data)
    if not items:
        return [], (0,)
    parts = [flatten(item) for item in items]
    inner = parts[0][1]
    flat = []
    for values, shape in parts:
        if shape != inner:
            raise ValueError(f"expected a sequence of equal-length rows, got shapes {inner} and {shape}")
        flat.extend(values)
    return flat, (len(items),) + inner


def list_buffer(flat, integer):
    """A typed array from a flat list of Python numbers (one C-level pack, one copy)."""
    import array

    return to_js(memoryview(array.array("i" if integer else "f", flat)))


def buffer_of(view, integer):
    """A typed array copy of a buffer (memoryview / array.array / numpy). A matching contiguous
    buffer crosses as one memcpy; any other format is repacked once."""
    mv = memoryview(view)
    want = "i" if integer else "f"
    if mv.format == want and mv.c_contiguous:
        return to_js(mv.cast("B").cast(want))
    flat, _ = flatten(mv.tolist())
    return list_buffer(flat, integer)
