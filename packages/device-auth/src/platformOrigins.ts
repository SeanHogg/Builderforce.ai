export const BUILDERFORCE_WEB_ORIGIN = 'https://builderforce.ai';
export const BUILDERFORCE_API_ORIGIN = 'https://api.builderforce.ai';
export const BUILDERFORCE_URL_ENV = 'BUILDERFORCE_URL';
export const LEGACY_SPAWN_URL_ENV = 'SYNAPSE_BUILDERFORCE_URL';
/** Editor transports use the main site's proxy for restrictive networks. */
export const EDITOR_GATEWAY_BASE = `${BUILDERFORCE_WEB_ORIGIN}/gateway`;
export const BUILDERFORCE_PLATFORM_ORIGINS = [BUILDERFORCE_WEB_ORIGIN, BUILDERFORCE_API_ORIGIN] as const;

export function resolvePlatformBaseUrl(configured: string | undefined, fallback: string): string {
  return (configured?.trim() || fallback).replace(/\/+$/, '');
}

export function derivePlatformWebBase(gateway: string): string {
  try {
    const url = new URL(gateway);
    url.hostname = url.hostname.replace(/^api\./, '');
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    // A malformed gateway setting has no browser origin.
  }
  return BUILDERFORCE_WEB_ORIGIN;
}
