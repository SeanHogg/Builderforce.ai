import { BUILDERFORCE_API_ORIGIN } from "@builderforce/device-auth";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { readSharedEnvVar } from "./env-file.js";

export const DEFAULT_BUILDERFORCE_API_URL = BUILDERFORCE_API_ORIGIN;

export function builderforceApiBase(explicit?: string): string {
  return normalizeBaseUrl(explicit?.trim() || readSharedEnvVar("BUILDERFORCE_URL") || DEFAULT_BUILDERFORCE_API_URL);
}

export function requestBuilderforce(
  path: `/api/${string}`,
  token: string,
  init: RequestInit = {},
  apiBase?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${builderforceApiBase(apiBase)}${path}`, { ...init, headers });
}
