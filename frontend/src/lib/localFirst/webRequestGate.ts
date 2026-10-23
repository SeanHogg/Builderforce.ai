// No `'use client'`: a plain module, guarded on `window`.
/**
 * THE web gate's DECISIONS — what a URL means (the shared route table) and whether the
 * person's inference mode lets it leave — kept light (no store, no boot) so every
 * transport can consult it synchronously: `apiClient` through `platformPolicy`'s
 * `assertWebApiRequest`, and every WebSocket opener through `openSocket`
 * (`lib/polling/reconnectPolicy`). `./platformPolicy` enforces, records and boots; the
 * rules are here, once.
 */
import {
  classifyPlatformRequest,
  platformRequestRefusal,
  resolveInferencePolicy,
  type PlatformCapability,
  type PlatformPolicySnapshot,
  type ResolvedInferencePolicy,
} from '@builderforce/local-first';
import { API_ORIGIN } from '../apiOrigin';
import { readLocal } from '../storage';
import { readStoredInferenceMode, webSignedIn } from './webInferenceMode';

export const WEB_PLATFORM_POLICY_STORAGE_KEY = 'bf_platform_policy_v1';

export const GRANTABLE: readonly (keyof PlatformPolicySnapshot)[] = [
  'synchronize',
  'gatewayInference',
  'connectedFeatures',
  'authenticate',
  'modelDownloads',
  'directProviders',
  'externalMcp',
  'gitRemotes',
];

/**
 * The origins classified as platform traffic: the platform API, plus the origin
 * that served this bundle. The page origin is here because a same-origin request
 * is this app talking to its own backend — a relative `/api/sync/push` must still
 * pass the gate, and `webPlatformFetch` reads a null classification as "not the
 * platform's business". A genuinely third-party host (a CDN, a direct model
 * provider) is a different origin and still classifies as null.
 */
function platformOrigins(): Set<string> {
  const origins = new Set<string>([API_ORIGIN]);
  if (typeof window !== 'undefined') origins.add(window.location.origin);
  return origins;
}

/**
 * The capability a request to the platform exercises, or null for a request that
 * is not the platform's (a CDN, a direct provider, a model registry). The path's
 * meaning is the shared route table, so one URL is the same capability in every
 * modality — a read-style POST (`/api/limbic/block`) is a connected feature.
 */
export function webPlatformCapabilityFor(input: string | URL, init?: RequestInit): PlatformCapability | null {
  const url = platformUrl(input);
  return url ? classifyPlatformRequest(url.pathname, init?.method ?? 'GET') : null;
}

/**
 * The URL as the platform sees it, or null when it is not the platform's (another
 * origin, unparsable). `ws:`/`wss:` are read as their `http:`/`https:` origin, so a
 * socket to the API is the API's.
 */
function platformUrl(input: string | URL): URL | null {
  let url: URL;
  try {
    url = new URL(typeof input === 'string' ? input : input.toString(), typeof window === 'undefined' ? API_ORIGIN : window.location.origin);
  } catch {
    return null;
  }
  const origin = url.protocol === 'wss:' || url.protocol === 'ws:'
    ? `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    : url.origin;
  return platformOrigins().has(origin) ? url : null;
}

function readStoredGrants(): Partial<PlatformPolicySnapshot> | null {
  const raw = readLocal(WEB_PLATFORM_POLICY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformPolicySnapshot>;
    const grants: Partial<PlatformPolicySnapshot> = {};
    for (const key of GRANTABLE) {
      if (typeof parsed[key] === 'boolean') grants[key] = parsed[key];
    }
    return grants;
  } catch {
    return null;
  }
}

/** The mode in force and the snapshot it derives, for a given signed-in state. */
export function webInferencePolicyFor(isSignedIn: boolean): ResolvedInferencePolicy {
  return resolveInferencePolicy({
    mode: readStoredInferenceMode(),
    signedIn: isSignedIn,
    overrides: readStoredGrants() ?? {},
  });
}

/**
 * Which capability, if any, refuses this request to the BuilderForce API — the web
 * twin of the VS Code host's global fetch guard and Rovr's guarded fetch, read from
 * the SAME route table and the person's resolved policy (live: the stored mode, the
 * overrides and {@link webSignedIn}). Null = it may go.
 *
 * The rules (authenticate never refused; Local only refuses inference and content;
 * Hybrid / Specific let ordinary writes go and hold the named sync transport to its
 * switch) are `platformRequestRefusal` in `@builderforce/local-first` — not restated here.
 *
 * `_credentialed` is kept on the signature for the transport that passes it; Local only
 * no longer reads it (content is refused anonymous or not).
 */
export function webApiRequestRefusal(input: string, method: string, _credentialed: boolean): PlatformCapability | null {
  // The policy is a browser's; a server render has no person to hold it for.
  if (typeof window === 'undefined') return null;
  const url = platformUrl(input);
  if (!url) return null;
  // THE shared decision (`platformRequestRefusal`) — the VS Code host, its webview and
  // Rovr call the same function, so one URL in one mode has one answer everywhere.
  return platformRequestRefusal({ pathname: url.pathname, method }, webInferencePolicyFor(webSignedIn()));
}

/**
 * The gate for a WebSocket — THE same decision as {@link webApiRequestRefusal}, read for
 * the socket's URL (an upgrade is a GET; `ws:`/`wss:` are the API's when their host is).
 * Under Local only a socket that carries the person's content — canvas session sync, a
 * room, an execution stream (the shared table's `content` tag) — is refused; the opener
 * then degrades to local-only quietly (`openSocket` parks its reconnector).
 */
export function webSocketRefusal(url: string): PlatformCapability | null {
  return webApiRequestRefusal(url, 'GET', true);
}
