import * as vscode from "vscode";
import {
  classifyPlatformRequest,
  createGuardedPlatformFetch,
  createPlatformPolicy,
  platformRequestMethod,
  platformRequestRefusal,
  platformRequestUrl,
  platformSendPermission,
  resolveInferencePolicy,
  type InferenceMode,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type PlatformRequestRecord,
} from "@builderforce/local-first";
import { bindInferenceMode, inferenceModeState, onDidChangeInferenceMode } from "./inferenceModeSetting";

const policy = createPlatformPolicy();
/** The mode in force — refused (`local-only`) until the first signed-in read resolves it. */
let mode: InferenceMode = "local-only";

/** The inference mode the request gate decides with (carried to the webview realm too). */
export function platformInferenceMode(): InferenceMode {
  return mode;
}
const requests: PlatformRequestRecord[] = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
let restoreFetch: (() => void) | undefined;

export function platformPolicy() {
  return policy;
}

export function platformRequestAccount(): { attempted: number; blocked: number; recent: readonly PlatformRequestRecord[] } {
  return {
    attempted: requests.filter((record) => record.outcome === "attempted").length,
    blocked: requests.filter((record) => record.outcome === "blocked").length,
    recent: [...requests],
  };
}

function configuredOrigins(): Set<string> {
  const origins = new Set(["https://builderforce.ai", "https://api.builderforce.ai"]);
  const config = vscode.workspace.getConfiguration("builderforce");
  for (const value of [config.get<string>("baseUrl"), config.get<string>("webUrl")]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // The request classifier treats an invalid configured URL as non-platform; the
      // settings UI remains responsible for reporting the invalid value.
    }
  }
  return origins;
}

/** The URL when it is this editor's platform (a configured origin), else null. */
function platformUrl(input: string | URL | Request): URL | null {
  let url: URL;
  try {
    url = new URL(platformRequestUrl(input));
  } catch {
    return null;
  }
  return configuredOrigins().has(url.origin) ? url : null;
}

/** The capability a request needs — the shared route table, for this editor's origins. */
export function platformCapabilityFor(input: string | URL | Request, init?: RequestInit): PlatformCapability | null {
  const url = platformUrl(input);
  return url ? classifyPlatformRequest(url.pathname, platformRequestMethod(input, init)) : null;
}

/**
 * Which capability refuses this request, or null when it may go — THE shared gate
 * (`platformRequestRefusal`), the same decision the web app and Rovr make for the same
 * URL in the same mode. Not the platform ⇒ null.
 */
export function platformRequestRefusalFor(input: string | URL | Request, init?: RequestInit): PlatformCapability | null {
  const url = platformUrl(input);
  if (!url) return null;
  return platformRequestRefusal({ pathname: url.pathname, method: platformRequestMethod(input, init) }, { mode, snapshot: policy.snapshot() });
}

const recordRequest = (record: PlatformRequestRecord): void => {
  requests.push(record);
  if (requests.length > 1_000) requests.splice(0, requests.length - 1_000);
};

/** An explicit capability call (`platformFetch(…, 'synchronize')`): that capability, strictly. */
const guarded = createGuardedPlatformFetch({
  policy,
  fetch: (input, init) => nativeFetch(input, init),
  onRequest: recordRequest,
});

/** Every other platform request (the global `fetch`): the shared request gate. */
const gatedGlobal = createGuardedPlatformFetch({
  policy,
  fetch: (input, init) => nativeFetch(input, init),
  onRequest: recordRequest,
  decide: (_capability, input, init) => platformRequestRefusalFor(input, init),
});

export function platformFetch(
  input: string,
  init: RequestInit | undefined,
  capability: PlatformCapability,
): Promise<Response> {
  return guarded(input, init, capability);
}

export function assertPlatformCapability(capability: PlatformCapability): void {
  policy.assert(capability);
}

export const outboxSendPermission = platformSendPermission(policy);

/** The advanced `builderforce.platform.*` overrides — the capabilities whose setting the
 *  person EXPLICITLY set in their USER settings; an unset one follows the inference mode.
 *  Each is `"scope": "application"` and is read from `globalValue` only: a cloned
 *  repository's `.vscode/settings.json` must never open a capability (or undo Local only). */
const OVERRIDABLE: readonly (keyof PlatformPolicySnapshot)[] = [
  "synchronize", "gatewayInference", "connectedFeatures", "modelDownloads", "directProviders", "externalMcp", "gitRemotes",
];

function explicitOverrides(): Partial<PlatformPolicySnapshot> {
  const config = vscode.workspace.getConfiguration("builderforce");
  const overrides: Partial<PlatformPolicySnapshot> = {};
  for (const field of OVERRIDABLE) {
    const seen = config.inspect?.<boolean>(`platform.${field}`);
    const value = seen?.globalValue;
    if (typeof value === "boolean") overrides[field] = value;
  }
  return overrides;
}

/** The mode-derived policy (`resolveInferencePolicy`), then the explicit overrides. The
 *  scoped `authenticate` grant of a sign-in in flight is left as it stands. */
function refreshPolicy(): void {
  const state = inferenceModeState();
  const resolved = resolveInferencePolicy({ mode: state.chosen ? state.mode : null, signedIn: state.signedIn, overrides: explicitOverrides() });
  const { authenticate: _authenticate, ...derived } = resolved.snapshot;
  mode = resolved.mode;
  policy.set(derived);
}

export async function withPlatformAuthentication<R>(work: () => Promise<R>): Promise<R> {
  policy.set({ authenticate: true });
  try {
    return await work();
  } finally {
    policy.set({ authenticate: false });
  }
}

let markResolved: () => void = () => undefined;
const resolved = new Promise<void>((resolve) => {
  markResolved = resolve;
});

/**
 * Resolves once the policy reflects the person's real state — the first signed-in read
 * has landed and the mode-derived snapshot is applied. Every platform call activation
 * starts (the heartbeat, the assigned-work poll, the codebase scan) waits on it: before
 * it, a signed-in person would read as signed out and be refused as Local only.
 */
export function platformPolicyResolved(): Promise<void> {
  return resolved;
}

/**
 * `secretKey`: the editor key's SecretStorage name — signed in decides the default mode.
 * The fetch guard is installed at once (the snapshot starts refused, so nothing leaks
 * meanwhile); the policy is resolved — {@link platformPolicyResolved} — only after the
 * secret read, never computed from a not-yet-read signed-out default.
 */
export function bindPlatformPolicy(context: vscode.ExtensionContext, secretKey?: string): Promise<void> {
  const signedInRead = bindInferenceMode(context, secretKey);
  void signedInRead.then(() => {
    refreshPolicy();
    markResolved();
  });
  context.subscriptions.push(onDidChangeInferenceMode(refreshPolicy));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("builderforce.platform")) refreshPolicy();
  }));
  if (restoreFetch) return resolved;
  const guardedGlobal: typeof fetch = (input, init) => {
    const capability = platformCapabilityFor(input, init);
    if (!capability) return nativeFetch(input, init);
    const url = platformRequestUrl(input);
    return gatedGlobal(url, { ...init, redirect: "error" }, capability);
  };
  globalThis.fetch = guardedGlobal;
  restoreFetch = () => {
    if (globalThis.fetch === guardedGlobal) globalThis.fetch = nativeFetch;
    restoreFetch = undefined;
  };
  context.subscriptions.push({ dispose: () => restoreFetch?.() });
  return resolved;
}
