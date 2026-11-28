import { BUILDERFORCE_API_ORIGIN, BUILDERFORCE_URL_ENV, resolvePlatformBaseUrl } from "@builderforce/device-auth";
import { readRuntimeEnvVar } from "./env-file.js";

export const DEFAULT_BUILDERFORCE_API_URL = BUILDERFORCE_API_ORIGIN;

export function builderforceAuthHeaders(token: string, agentHostId?: string | number) {
  const headers: Record<string, string> & { Authorization: string } = { Authorization: `Bearer ${token}` };
  if (agentHostId !== undefined) headers["X-AgentHost-Id"] = String(agentHostId);
  return headers;
}

export function builderforceApiBase(explicit?: string): string {
  return resolvePlatformBaseUrl(explicit?.trim() || readRuntimeEnvVar(BUILDERFORCE_URL_ENV), DEFAULT_BUILDERFORCE_API_URL);
}

export function builderforceRegistryBase(explicit?: string): string {
  return resolvePlatformBaseUrl(explicit?.trim() || readRuntimeEnvVar("BUILDERFORCE_AGENTS_LINK_URL"), DEFAULT_BUILDERFORCE_API_URL);
}

export function requestBuilderforce(
  path: `/api/${string}`,
  token: string,
  init: RequestInit = {},
  apiBase?: string,
): Promise<Response> {
  return fetchBuilderforce(`${builderforceApiBase(apiBase)}${path}`, init, token);
}

export function fetchBuilderforce(url: string, init: RequestInit, token?: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", builderforceAuthHeaders(token).Authorization);
  return fetch(url, { ...init, headers });
}
