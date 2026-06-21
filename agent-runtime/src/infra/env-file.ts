import fs from "node:fs";
import path from "node:path";
import { escapeRegExp, resolveConfigDir } from "../utils.js";

export function upsertSharedEnvVar(params: {
  key: string;
  value: string;
  env?: NodeJS.ProcessEnv;
}): { path: string; updated: boolean; created: boolean } {
  const env = params.env ?? process.env;
  const dir = resolveConfigDir(env);
  const filepath = path.join(dir, ".env");
  const key = params.key.trim();
  const value = params.value;

  let raw = "";
  if (fs.existsSync(filepath)) {
    raw = fs.readFileSync(filepath, "utf8");
  }

  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const matcher = new RegExp(`^(\\s*(?:export\\s+)?)${escapeRegExp(key)}\\s*=`);
  let updated = false;
  let replaced = false;

  const nextLines = lines.map((line) => {
    const match = line.match(matcher);
    if (!match) {
      return line;
    }
    replaced = true;
    const prefix = match[1] ?? "";
    const next = `${prefix}${key}=${value}`;
    if (next !== line) {
      updated = true;
    }
    return next;
  });

  if (!replaced) {
    nextLines.push(`${key}=${value}`);
    updated = true;
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const output = `${nextLines.join("\n")}\n`;
  fs.writeFileSync(filepath, output, "utf8");
  fs.chmodSync(filepath, 0o600);

  return { path: filepath, updated, created: !raw };
}

/**
 * Read a single key from `~/.builderforce/.env`.
 * Returns the raw value string, or undefined if the key is absent.
 */
export function readSharedEnvVar(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dir = resolveConfigDir(env);
  const filepath = path.join(dir, ".env");
  if (!fs.existsSync(filepath)) {
    return undefined;
  }
  const raw = fs.readFileSync(filepath, "utf8");
  const matcher = new RegExp(`^(?:export\\s+)?${escapeRegExp(key.trim())}=(.*)$`, "m");
  const match = raw.match(matcher);
  return match ? match[1]?.trim() || undefined : undefined;
}

/**
 * Read a key from the live process environment first, then fall back to the
 * shared `~/.builderforce/.env` file. Used for switches that operators may set
 * either way (an exported env var or a persisted `.env` entry).
 */
export function readRuntimeEnvVar(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromProcess = env[key.trim()];
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }
  return readSharedEnvVar(key, env);
}

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return TRUTHY_ENV_VALUES.has(value.trim().toLowerCase());
}

/**
 * Offline / air-gapped standalone mode.
 *
 * When enabled (env `BUILDERFORCE_OFFLINE` / `BUILDERFORCE_AIRGAP` set to a
 * truthy value, in either the process env or `~/.builderforce/.env`), the
 * runtime must make ZERO required outbound calls to the builderforce.ai /
 * Cloudflare control plane: cron-poller, workflow-poller, fleet/relay sync,
 * knowledge-loop upstream sync, hired-agents/persona sync, directory sync and
 * remote dispatch are all gated off. The local agent loop, local model
 * inference (Ollama / local providers) and the local MCP/dev tools keep
 * working.
 *
 * This is the single source of truth for the offline switch — pollers and sync
 * services consult it rather than re-implementing their own env checks.
 */
export function isOfflineMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isTruthyFlag(readRuntimeEnvVar("BUILDERFORCE_OFFLINE", env)) ||
    isTruthyFlag(readRuntimeEnvVar("BUILDERFORCE_AIRGAP", env))
  );
}
