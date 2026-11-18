import type { TorchBridge } from "./bridge";
import { PYTHON_FILES } from "./python-files";

/**
 * What a Python host needs to offer `import torch`: one JS module and the
 * pure-Python package files, written outside the project and put on
 * `sys.path`. Described as a plain value so a host (the webcontainers Python
 * worker) applies it through a generic "Python extension" hook without
 * knowing anything about torch; `installPythonExtension` is that hook's
 * reference implementation (used by the tests).
 */

/** The JS module name `torch/_bridge.py` imports. */
export const TORCH_JS_MODULE = "_webdit_torch";

/** Where the package files go in Pyodide's file system (outside any project mount). */
export const TORCH_PYTHON_ROOT = "/opt/webdit-torch";

export interface PythonExtension {
  /** `pyodide.registerJsModule(name, module)` for each entry, before any Python imports them. */
  jsModules: Readonly<Record<string, object>>;
  /** Package files, path (relative to `root`) → source text. */
  files: Readonly<Record<string, string>>;
  /** Directory the files are written under; prepended to `sys.path`. */
  root: string;
}

/** The structural slice of the Pyodide API the install needs (no dependency on the `pyodide` package). */
export interface PyodideInstallTarget {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
  registerJsModule(name: string, module: object): void;
  runPython(code: string): unknown;
}

/** The Python package files (path → text), bundled at build time from `python/` by `scripts/gen-python-files.mjs`. */
export function torchPythonFiles(): Record<string, string> {
  return { ...PYTHON_FILES };
}

export function torchPythonExtension(bridge: TorchBridge): PythonExtension {
  return { jsModules: { [TORCH_JS_MODULE]: bridge }, files: PYTHON_FILES, root: TORCH_PYTHON_ROOT };
}

export function installPythonExtension(pyodide: PyodideInstallTarget, extension: PythonExtension): void {
  for (const [name, module] of Object.entries(extension.jsModules)) pyodide.registerJsModule(name, module);
  for (const [path, source] of Object.entries(extension.files)) {
    const full = `${extension.root}/${path}`;
    pyodide.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    pyodide.FS.writeFile(full, source);
  }
  const root = JSON.stringify(extension.root);
  pyodide.runPython(`import sys\nif ${root} not in sys.path: sys.path.insert(0, ${root})`);
}
