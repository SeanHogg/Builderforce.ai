/**
 * `@webdit/torch/pyodide` — PyTorch for Python in Pyodide, over the engine.
 *
 *   const bridge = await createTorchBridge({ gpu: navigator.gpu });
 *   installPythonExtension(pyodide, torchPythonExtension(bridge));
 *   await pyodide.runPythonAsync("import torch; ...");
 *
 * Run Python through a promising call (`runPythonAsync`) so readback
 * (`.item()`, `.tolist()`, `torch.save`) can block through JSPI; without JSPI
 * use the `*_async()` awaitables.
 */
export { createTorchBridge, type TorchBridge, type TorchBridgeOptions, type DeviceName } from "./bridge";
export { OPS, type OpArg } from "./ops";
export {
  TORCH_JS_MODULE,
  TORCH_PYTHON_ROOT,
  torchPythonFiles,
  torchPythonExtension,
  installPythonExtension,
  type PythonExtension,
  type PyodideInstallTarget,
} from "./install";
