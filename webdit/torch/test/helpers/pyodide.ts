import { loadPyodide, type PyodideAPI } from "pyodide";
import { createTorchBridge, installPythonExtension, torchPythonExtension, type TorchBridge, type TorchBridgeOptions } from "../../src/pyodide";

/**
 * A Pyodide interpreter (the pinned `pyodide` npm package, run in Node) with
 * `import torch` wired to a fresh bridge — the same install a host performs.
 * `run` executes through `runPythonAsync` (a promising call, so readback
 * blocks through JSPI), with `globals` injected, and returns the value of the
 * last expression converted to JS.
 */
export interface TorchPython {
  pyodide: PyodideAPI;
  bridge: TorchBridge;
  run<T = unknown>(code: string, globals?: Record<string, unknown>): Promise<T>;
  /** The same, through the SYNCHRONOUS `runPython` — no JSPI suspension possible. */
  runSync<T = unknown>(code: string, globals?: Record<string, unknown>): T;
}

type PyValue = { toJs?: (o: object) => unknown; destroy?: () => void } | unknown;

function toJs(value: PyValue): unknown {
  if (value && typeof value === "object" && "toJs" in value && typeof value.toJs === "function") {
    const out = value.toJs({ dict_converter: Object.fromEntries, create_pyproxies: false });
    (value as { destroy?: () => void }).destroy?.();
    return out;
  }
  return value;
}

export async function startTorchPython(options: TorchBridgeOptions = {}): Promise<TorchPython> {
  const pyodide = await loadPyodide();
  const bridge = await createTorchBridge({ gpu: false, ...options });
  installPythonExtension(pyodide, torchPythonExtension(bridge));
  const ns = (globals: Record<string, unknown>) => {
    const dict = pyodide.toPy({});
    for (const [k, v] of Object.entries(globals)) {
      if (typeof v === "function" || v === null || typeof v !== "object") {
        dict.set(k, v);
        continue;
      }
      const py = pyodide.toPy(v); // arrays → Python lists, objects → dicts
      dict.set(k, py);
      py.destroy();
    }
    return dict;
  };
  // Every Pyodide suite relies on JSPI readback: fail loudly (not vacuously) where the runtime lacks it.
  const jspi = await pyodide.runPythonAsync("from pyodide.ffi import can_run_sync\ncan_run_sync()");
  if (jspi !== true) {
    throw new Error(
      "JSPI is unavailable in this Node (pyodide.ffi.can_run_sync() is False inside runPythonAsync): run on Node ≥ 26, " +
        "or Node 24 with --experimental-wasm-jspi (vitest.config.ts adds it when WebAssembly.Suspending is missing).",
    );
  }
  return {
    pyodide,
    bridge,
    async run<T>(code: string, globals: Record<string, unknown> = {}) {
      const g = ns(globals);
      try {
        return toJs(await pyodide.runPythonAsync(code, { globals: g })) as T;
      } finally {
        g.destroy();
      }
    },
    runSync<T>(code: string, globals: Record<string, unknown> = {}) {
      const g = ns(globals);
      try {
        return toJs(pyodide.runPython(code, { globals: g })) as T;
      } finally {
        g.destroy();
      }
    },
  };
}
