/**
 * The torch Python extension's factory (PRD 31 §W9 phase 7) — the module a Python
 * process Worker imports (`PythonHostOptions.extensions`, see
 * `lib/browserRuntime/previewPythonOptions.ts`) and calls before the program runs, so
 * `import torch` / `import peft` work in a blueprint's `training` service.
 *
 * It runs INSIDE the Worker: the bridge it builds (and its WebGPU device, when the
 * Worker has `navigator.gpu`) lives beside the interpreter. Without WebGPU the bridge
 * still answers on the CPU reference backend, and `torch.cuda`-style device checks
 * report why (`webgpu_unavailable_reason()`). It is bundled on its own as
 * `torch-extension.js` and served next to the relay on the preview origin; nothing in
 * the app's own bundle imports it.
 */
import type { PythonExtension } from '@seanhogg/builderforce-webcontainers/app';
import { createTorchBridge, torchPythonExtension } from '@webdit/torch/pyodide';
import { PREVIEW_PYTHON_PROVIDES } from '@/lib/browserRuntime/previewPythonOptions';

/** The factory the Worker calls (named by `TORCH_EXTENSION_EXPORT` in previewPythonOptions.ts). */
export async function createTorchExtension(): Promise<PythonExtension> {
  const bridge = await createTorchBridge();
  return { ...torchPythonExtension(bridge), provides: [...PREVIEW_PYTHON_PROVIDES] };
}
