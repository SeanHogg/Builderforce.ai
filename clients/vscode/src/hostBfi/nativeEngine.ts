/**
 * Synapse's engine running INSIDE the editor: `@seanhogg/bfi-node`, the native addon of
 * `bfi-engine` — the same `BfiEngine` contract as the vendored wasm, on native wgpu
 * (Vulkan; Metal on macOS) or every CPU core, with the native KV budget. The host's `bfi`
 * worker runs it when the addon for this platform ships in `out/` and loads; otherwise
 * the wasm serves (CPU, single-threaded) exactly as before.
 *
 * Node only — never imported by a webview-reachable file.
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { loadBfiNode } from "@seanhogg/bfi-node";
import type { BfiModule } from "@seanhogg/builderforce-brain-embedded/bfi";

/** The addon `esbuild.mjs` copies beside the bundle (this platform's prebuilt one). */
export const HOST_BFI_NATIVE_FILE = "bfi_node.node";

/** The addon's path in an install, when this build ships one. */
export function nativeAddonPath(outDir: string, exists: (file: string) => boolean = existsSync): string | undefined {
  const file = path.join(outDir, HOST_BFI_NATIVE_FILE);
  return exists(file) ? file : undefined;
}

/**
 * The native engine module, or null when there is no addon or it will not load on this
 * machine (a missing system library, an unsupported CPU) — `onFailure` hears why, and the
 * caller falls back to the wasm.
 */
export function loadNativeBfi(addonPath: string | undefined, onFailure?: (error: unknown) => void): BfiModule | null {
  if (!addonPath) return null;
  try {
    return loadBfiNode(addonPath);
  } catch (error) {
    onFailure?.(error);
    return null;
  }
}
