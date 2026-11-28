import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { escapeRegExp, resolveConfigDir } from "../utils.js";
import {
  isBuilderforceCredential,
  readBuilderforceCredential,
  storeBuilderforceCredential,
  warnBuilderforceCredentialFallback,
} from "./builderforce-credential-store.js";

function envAssignment(key: string): RegExp {
  return new RegExp(`^(\\s*(?:export\\s+)?)${escapeRegExp(key)}\\s*=`);
}

function writePrivateEnvFile(filepath: string, output: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true, mode: 0o700 });
  const temporary = `${filepath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filepath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

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
  const matcher = envAssignment(key);
  if (isBuilderforceCredential(key)) {
    if (!value.trim() || /[\r\n\0]/.test(value)) {
      throw new Error("Builderforce credentials must be non-empty and fit on one line.");
    }
    if (storeBuilderforceCredential(dir, key, value)) {
      const retained = lines.filter((line) => !matcher.test(line));
      if (retained.length !== lines.length) writePrivateEnvFile(filepath, retained.join("\n"));
      return { path: filepath, updated: true, created: !raw };
    }
    warnBuilderforceCredentialFallback();
  }
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

  const output = `${nextLines.join("\n")}\n`;
  writePrivateEnvFile(filepath, output);

  return { path: filepath, updated, created: !raw };
}

/**
 * Read a persisted runtime setting. Builderforce credentials can also live in the
 * system credential store.
 */
export function readSharedEnvVar(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  key = key.trim();
  const dir = resolveConfigDir(env);
  const filepath = path.join(dir, ".env");
  const raw = fs.existsSync(filepath) ? fs.readFileSync(filepath, "utf8") : "";
  const matcher = envAssignment(key);
  const literal = raw.split(/\r?\n/).find((line) => matcher.test(line))?.replace(matcher, "").trim() || undefined;
  if (!isBuilderforceCredential(key)) return literal;
  if (!literal) return readBuilderforceCredential(dir, key);

  // A saved fallback takes precedence over an older keychain value. The next
  // successful sign-in removes the fallback while updating the credential.
  if (process.platform !== "win32") fs.chmodSync(filepath, 0o600);
  warnBuilderforceCredentialFallback();
  return literal;
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

/** The ONE spelling of a truthy env flag in the runtime. */
export function isTruthyFlag(value: string | undefined): boolean {
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
