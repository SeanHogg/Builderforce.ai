import fs from "node:fs";
import path from "node:path";
import { saveJsonFile } from "../../infra/json-file.js";
import { resolveUserPath } from "../../utils.js";
import { resolveBuilderForceAgentsAgentDir } from "../agent-paths.js";
import { AUTH_PROFILE_FILENAME, AUTH_STORE_VERSION, LEGACY_AUTH_FILENAME } from "./constants.js";
import type { AuthProfileStore } from "./types.js";

export function resolveAuthStorePath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveBuilderForceAgentsAgentDir());
  return path.join(resolved, AUTH_PROFILE_FILENAME);
}

export function resolveLegacyAuthStorePath(agentDir?: string): string {
  const resolved = resolveUserPath(agentDir ?? resolveBuilderForceAgentsAgentDir());
  return path.join(resolved, LEGACY_AUTH_FILENAME);
}

export function resolveAuthStorePathForDisplay(agentDir?: string): string {
  const pathname = resolveAuthStorePath(agentDir);
  return pathname.startsWith("~") ? pathname : resolveUserPath(pathname);
}

export async function ensureAuthStoreFile(pathname: string): Promise<void> {
  if (fs.existsSync(pathname)) {
    return;
  }
  const payload: AuthProfileStore = {
    version: AUTH_STORE_VERSION,
    profiles: {},
  };
  await saveJsonFile(pathname, payload);
}
