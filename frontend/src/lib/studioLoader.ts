/**
 * The ONE way the frontend loads `@seanhogg/builderforce-studio` at runtime.
 *
 * Studio's `onnx-runtime-config` is the single ORT configurer, and its jsDelivr default
 * is blocked by the app's CSP (`script-src`). So before any consumer can start an ORT
 * session, the host's WASM base (the host's copy, else same-origin `/ort/`) is handed to
 * studio — once, here. Every lazy studio import in the app goes through `loadStudio()`.
 */
import { canvasWasmBaseUrl } from './canvasHost';
import { resolveOrtWasmPaths } from './ortWasmPaths';

export type StudioModule = typeof import('@seanhogg/builderforce-studio');

let loading: Promise<StudioModule> | null = null;

export function loadStudio(): Promise<StudioModule> {
  loading ??= import('@seanhogg/builderforce-studio')
    .then((studio) => {
      studio.setOrtWasmBase(resolveOrtWasmPaths(canvasWasmBaseUrl()));
      return studio;
    })
    .catch((error: unknown) => {
      loading = null; // a later call may retry (chunk fetch failed, say)
      throw error;
    });
  return loading;
}
