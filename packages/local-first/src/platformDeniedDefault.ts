/**
 * API-denied default (G01).
 *
 * Offline platform connectivity is its own decision. It does not read host
 * configuration and it does not follow the local-models setting, a saved
 * gateway key, or an explicit gateway-fallback choice. When the API is denied,
 * gateway inference is forbidden and sync stays on the device.
 *
 * This module classifies only. It does not fetch, open a socket, or load a
 * network client.
 */

export type PlatformAccess = 'denied' | 'allowed';

export type InferencePermission = 'local-only' | 'gateway-allowed';

export type SyncPolicy = 'local' | 'connected';

export interface PlatformConnectivityInput {
  /** True when platform API access is denied. Anything other than false is denied. */
  readonly apiDenied?: boolean | null;
  /** A saved gateway key must not reopen inference while the API is denied. */
  readonly savedGatewayKey?: boolean | null;
  /** The local-models setting must not decide platform connectivity. */
  readonly localModelsEnabled?: boolean | null;
  /** Explicit gateway fallback. Honoured only when the API is not denied. */
  readonly gatewayFallback?: boolean | null;
}

export interface PlatformConnectivity {
  readonly platform: PlatformAccess;
  readonly inference: InferencePermission;
  readonly sync: SyncPolicy;
}

const DENIED: PlatformConnectivity = Object.freeze({
  platform: 'denied',
  inference: 'local-only',
  sync: 'local',
});

const CONNECTED_LOCAL_INFERENCE: PlatformConnectivity = Object.freeze({
  platform: 'allowed',
  inference: 'local-only',
  sync: 'connected',
});

const CONNECTED_GATEWAY: PlatformConnectivity = Object.freeze({
  platform: 'allowed',
  inference: 'gateway-allowed',
  sync: 'connected',
});

/**
 * Decide platform connectivity, inference permission, and sync policy.
 *
 * `apiDenied === true`, a missing input, and any value other than false deny
 * the platform. Gateway fallback is then forbidden even if a key is saved,
 * local models are enabled, or gateway fallback was requested.
 *
 * When the API is not denied, gateway fallback is allowed only if
 * `gatewayFallback === true`. A saved key and the local-models setting never
 * grant it.
 */
export function platformConnectivity(
  input: PlatformConnectivityInput | null | undefined,
): PlatformConnectivity {
  if (input == null || input.apiDenied !== false) return DENIED;
  if (input.gatewayFallback === true) return CONNECTED_GATEWAY;
  return CONNECTED_LOCAL_INFERENCE;
}
