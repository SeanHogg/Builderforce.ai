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
import { addonFileName, loadBfiNode } from "@seanhogg/bfi-node";
import type { BfiModule } from "@seanhogg/builderforce-brain-embedded/bfi";

/**
 * This platform's addon in an install, when the build ships one. `esbuild.mjs` copies every
 * vendored addon into `out/` under its tagged name, so only this host's own file is ever
 * considered — another platform's binary is never loaded.
 */
export function nativeAddonPath(
  outDir: string,
  exists: (file: string) => boolean = existsSync,
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const file = path.join(outDir, addonFileName(platform, arch));
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
