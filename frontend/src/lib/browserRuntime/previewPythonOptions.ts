/**
 * The Python the preview runtime's Python processes run (PRD 31 §W9 phase 7) — ONE place
 * for what the runtime boots with (`previewRuntime.ts` passes `previewPythonOptions(relayUrl)`
 * as `python`), what the run target's `python` provider is told the extensions provide,
 * and what the browser acceptance check judges by (`runTarget/browserAcceptance.ts`).
 * Type-only imports, so the acceptance path reads it without pulling the runtime in.
 *
 * - `extensions`: `import torch` (and the `peft` LoRA subset) inside every Python Worker,
 *   from `@webdit/torch` — built by the Worker-side factory `lib/training/torchPythonExtension.ts`,
 *   served beside the relay on the preview origin (the Worker's CSP allows `'self'` scripts).
 * - `training`: training services checkpoint on stop and keep their artifacts in this
 *   page's IndexedDB (`createTrainingArtifactStore()`'s default database) under
 *   {@link TRAINING_HOST_PROJECT_ID}, the application's spec `projectId` (the Builderforce
 *   project) and the service id — what `lib/training/trainingServiceAdapter.ts` reads back.
 */
import type { PythonHostOptions } from '@seanhogg/builderforce-webcontainers/app';

/** Distribution names the torch extension satisfies: requirements naming them are never declined as native-only. */
export const PREVIEW_PYTHON_PROVIDES: readonly string[] = ['torch', 'peft'];

/** The host project id every training artifact key starts with: one page-wide runtime, so one host id. */
export const TRAINING_HOST_PROJECT_ID = 'builderforce';

/** The torch extension's script, next to `relay.html` on the preview origin, and its factory export. */
export const TORCH_EXTENSION_SCRIPT = 'torch-extension.js';
export const TORCH_EXTENSION_EXPORT = 'createTorchExtension';

/** Whether the runtime boots with training services enabled (it does: `training` below is always set). */
export const PREVIEW_PYTHON_TRAINING = true;

/** The `python` boot options for a runtime whose relay page is `relayUrl`. */
export function previewPythonOptions(relayUrl: string): PythonHostOptions {
  return {
    extensions: [{ moduleUrl: new URL(TORCH_EXTENSION_SCRIPT, relayUrl).href, exportName: TORCH_EXTENSION_EXPORT }],
    training: { projectId: TRAINING_HOST_PROJECT_ID },
  };
}
