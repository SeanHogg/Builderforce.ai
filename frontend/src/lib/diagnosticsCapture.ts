/**
 * The impure half of a diagnostics report: read the build stamps and the clock
 * once, so every report builder stays a pure function of its input.
 *
 * The API version comes from `GET /health` (the same `version` the deploy stamps
 * into its OpenAPI doc) and is cached, so a page full of "Copy diagnostics"
 * buttons costs one request. A failure degrades to "unknown" — a report that
 * cannot name its API build is still worth pasting, and a report that never
 * appears because the version lookup threw is not.
 */

import { AGENT_ENGINE, APP_VERSION, BRAIN_VERSION, RUNTIME_VERSION } from '@/lib/buildVersion';
import { getCanvasHost } from '@/lib/canvasHost';
import { fetchApiVersion } from '@/lib/appVersions';
import type { DiagnosticsContext, DiagnosticsHost } from '@/lib/diagnosticsReport';

export interface DiagnosticsHostInput {
  /** Registered canvas host surface, or `web` when none is installed. */
  surface: 'web' | 'vscode';
  /** Extension version the VSIX host registered, when it registered one. */
  canvasHostVersion: string | null;
  /** Web frontend build (`APP_VERSION`). */
  appVersion: string;
  /** `location.protocol`. `chrome-extension:` is Rovr (or any extension page). */
  locationProtocol: string;
  /** `chrome.runtime.getManifest().version`, when that call succeeded. */
  extensionManifestVersion: string | null;
}

/**
 * Which install produced this capture, and that install's version.
 *
 * Web names the frontend build (the same number as `uiVersion`). VSIX names the
 * extension version the host registered — not the web bundle the webview
 * compiled, which is still `uiVersion`. Rovr names the Chrome extension
 * manifest. The web canvas never calls `registerCanvasHost`, so an unregistered
 * page is `web` unless it is actually running inside an extension page.
 */
export function resolveDiagnosticsHost(input: DiagnosticsHostInput): {
  host: DiagnosticsHost;
  hostVersion: string | null;
} {
  if (input.surface === 'vscode') {
    return { host: 'vsix', hostVersion: present(input.canvasHostVersion) };
  }
  if (input.locationProtocol === 'chrome-extension:') {
    return { host: 'rovr', hostVersion: present(input.extensionManifestVersion) };
  }
  return { host: 'web', hostVersion: present(input.appVersion) };
}

function present(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extensionManifestVersion(): string | null {
  const getManifest = (globalThis as {
    chrome?: { runtime?: { getManifest?: () => { version?: string } } };
  }).chrome?.runtime?.getManifest;
  if (typeof getManifest !== 'function') return null;
  // A page that isn't an extension can still expose a `chrome.runtime` stub that
  // throws. The protocol already named the host; the version is then unknown.
  try {
    const version = getManifest().version;
    return typeof version === 'string' && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

function locationProtocol(): string {
  return typeof location === 'undefined' ? '' : location.protocol;
}

/** Capture the provenance block. Never throws and never hangs — the version
 *  lookup's own deadline is what bounds a stalled `/health`. */
export async function captureDiagnosticsContext(): Promise<DiagnosticsContext> {
  const apiVersion = await fetchApiVersion().catch(() => null);
  const host = resolveDiagnosticsHost({
    surface: getCanvasHost()?.surface ?? 'web',
    canvasHostVersion: getCanvasHost()?.hostVersion ?? null,
    appVersion: APP_VERSION,
    locationProtocol: locationProtocol(),
    extensionManifestVersion: extensionManifestVersion(),
  });
  return {
    uiVersion: APP_VERSION,
    apiVersion,
    host: host.host,
    hostVersion: host.hostVersion,
    // The engine has no version of its own. `@<apiVersion>` is the deploy stamp of
    // the API worker it ships in. A canvas turn does not run that loop — it runs
    // the embedded Brain (`brainVersion`).
    engine: apiVersion ? `${AGENT_ENGINE}@${apiVersion}` : AGENT_ENGINE,
    brainVersion: BRAIN_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    capturedAt: new Date().toISOString(),
    sourceUrl: typeof window === 'undefined' ? null : window.location.href,
  };
}
