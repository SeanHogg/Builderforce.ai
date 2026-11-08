import { createRequire } from "node:module";
import {
  compileSecretPattern,
  redactText,
  secretPatternSources,
  type SecretPattern,
} from "@builderforce/secret-redaction";
import type { BuilderForceAgentsConfig } from "../config/config.js";

// The patterns, masking rule and matching live in @builderforce/secret-redaction (shared with the api).
// This module is only the CONFIG OVERLAY: the `logging.redactSensitive` mode and `logging.redactPatterns`.

const requireConfig = createRequire(import.meta.url);

export type RedactSensitiveMode = "off" | "tools";

const DEFAULT_REDACT_MODE: RedactSensitiveMode = "tools";

type RedactOptions = {
  mode?: RedactSensitiveMode;
  patterns?: string[];
};

function normalizeMode(value?: string): RedactSensitiveMode {
  return value === "off" ? "off" : DEFAULT_REDACT_MODE;
}

function resolvePatterns(value?: string[]): SecretPattern[] {
  const source = value?.length ? value : secretPatternSources();
  return source
    .map(compileSecretPattern)
    .filter((re): re is RegExp => Boolean(re))
    .map((re) => ({ re }));
}

function resolveConfigRedaction(): RedactOptions {
  let cfg: BuilderForceAgentsConfig["logging"] | undefined;
  try {
    const loaded = requireConfig("../config/config.js") as {
      loadConfig?: () => BuilderForceAgentsConfig;
    };
    cfg = loaded.loadConfig?.().logging;
  } catch {
    cfg = undefined;
  }
  return {
    mode: normalizeMode(cfg?.redactSensitive),
    patterns: cfg?.redactPatterns,
  };
}

export function redactSensitiveText(text: string, options?: RedactOptions): string {
  if (!text) {
    return text;
  }
  const resolved = options ?? resolveConfigRedaction();
  if (normalizeMode(resolved.mode) === "off") {
    return text;
  }
  const patterns = resolvePatterns(resolved.patterns);
  if (!patterns.length) {
    return text;
  }
  // "display": a log line the operator reads keeps prefix+suffix of a long secret to tell keys apart.
  return redactText(text, patterns, "display");
}

export function redactToolDetail(detail: string): string {
  const resolved = resolveConfigRedaction();
  if (normalizeMode(resolved.mode) !== "tools") {
    return detail;
  }
  return redactSensitiveText(detail, resolved);
}

export function getDefaultRedactPatterns(): string[] {
  return secretPatternSources();
}
