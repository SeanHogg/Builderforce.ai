import * as vscode from "vscode";
import {
  createGuardedPlatformFetch,
  createPlatformPolicy,
  platformSendPermission,
  type PlatformCapability,
  type PlatformRequestRecord,
} from "@builderforce/local-first";

const policy = createPlatformPolicy();
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

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export function platformCapabilityFor(input: string | URL | Request, init?: RequestInit): PlatformCapability | null {
  const raw = requestUrl(input);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!configuredOrigins().has(url.origin)) return null;
  if (url.pathname.includes("/api/auth/") || url.pathname.endsWith("/token")) return "authenticate";
  if (url.pathname.includes("/chat/completions")) return "gateway-inference";
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  return method === "GET" || method === "HEAD" ? "connected-feature" : "synchronize";
}

const guarded = createGuardedPlatformFetch({
  policy,
  fetch: (input, init) => nativeFetch(input, init),
  onRequest(record) {
    requests.push(record);
    if (requests.length > 1_000) requests.splice(0, requests.length - 1_000);
  },
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

function refreshPolicy(): void {
  const config = vscode.workspace.getConfiguration("builderforce");
  policy.set({
    synchronize: config.get<boolean>("platform.synchronize") === true,
    gatewayInference: config.get<boolean>("platform.gatewayInference") === true,
    connectedFeatures: config.get<boolean>("platform.connectedFeatures") === true,
    modelDownloads: config.get<boolean>("platform.modelDownloads") === true,
    directProviders: config.get<boolean>("platform.directProviders") === true,
    externalMcp: config.get<boolean>("platform.externalMcp") === true,
    gitRemotes: config.get<boolean>("platform.gitRemotes") === true,
  });
}

export async function withPlatformAuthentication<R>(work: () => Promise<R>): Promise<R> {
  policy.set({ authenticate: true });
  try {
    return await work();
  } finally {
    policy.set({ authenticate: false });
  }
}

export function bindPlatformPolicy(context: vscode.ExtensionContext): void {
  refreshPolicy();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("builderforce.platform")) refreshPolicy();
  }));
  if (restoreFetch) return;
  const guardedGlobal: typeof fetch = (input, init) => {
    const capability = platformCapabilityFor(input, init);
    if (!capability) return nativeFetch(input, init);
    const url = requestUrl(input);
    return guarded(url, { ...init, redirect: "error" }, capability);
  };
  globalThis.fetch = guardedGlobal;
  restoreFetch = () => {
    if (globalThis.fetch === guardedGlobal) globalThis.fetch = nativeFetch;
    restoreFetch = undefined;
  };
  context.subscriptions.push({ dispose: () => restoreFetch?.() });
}
