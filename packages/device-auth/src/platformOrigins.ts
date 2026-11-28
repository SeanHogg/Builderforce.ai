export const BUILDERFORCE_WEB_ORIGIN = 'https://builderforce.ai';
export const BUILDERFORCE_API_ORIGIN = 'https://api.builderforce.ai';
/** Editor transports use the main site's proxy for restrictive networks. */
export const EDITOR_GATEWAY_BASE = `${BUILDERFORCE_WEB_ORIGIN}/gateway`;
export const BUILDERFORCE_PLATFORM_ORIGINS = [BUILDERFORCE_WEB_ORIGIN, BUILDERFORCE_API_ORIGIN] as const;
