/**
 * Where the preview runtime's .NET processes load the .NET runtime bundle — ONE
 * function, given to `startPreviewRuntime({ dotnet })` (`previewRuntime.ts`).
 *
 * The bundle (~73 MiB, Mono browser-wasm) is served by the API on the preview origin at
 * `/dotnet/<version>/` (`api/src/presentation/middleware/dotnetBundleRoute.ts`): same
 * origin as the relay, because the process Workers load scripts only from their own
 * origin. `<version>` is the `@seanhogg/builderforce-webcontainers` this build installed
 * (`RUNTIME_VERSION`, stamped by next.config.js) — the release mirrors exactly that
 * version's bundle — so the runtime and its bundle can never mismatch after a bump.
 *
 * Without a stamped version there is no `bundleUrl`, and `dotnet` commands decline with
 * the runtime's own reason. Its own light module, so callers read it without the runtime.
 */
import type { DotnetHostOptions } from '@seanhogg/builderforce-webcontainers/app';
import { RUNTIME_VERSION } from '@/lib/buildVersion';

/** Where the API serves the bundle on the preview origin (dotnetBundleRoute.ts `DOTNET_BUNDLE_PATH_PREFIX`). */
export const DOTNET_BUNDLE_PATH = '/dotnet/';

/** An exact package version — what the route accepts (never a range, a tag or the unstamped `—`). */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The `dotnet` options for a runtime whose relay is `relayUrl`: the bundle on the relay's own origin. */
export function previewDotnetOptions(relayUrl: string, version: string = RUNTIME_VERSION): DotnetHostOptions {
  if (!VERSION.test(version)) return {};
  return { bundleUrl: new URL(`${DOTNET_BUNDLE_PATH}${version}/`, relayUrl).href };
}
