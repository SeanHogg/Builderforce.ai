/**
 * Preserves `${VAR}` environment variable references during config write-back.
 *
 * When config is read, `${VAR}` references are resolved to their values.
 * When writing back, callers pass the resolved config. This module detects
 * values that match what a `${VAR}` reference would resolve to and restores
 * the original reference, so env var references survive config round-trips.
 *
 * A value is restored only if:
 * 1. The pre-substitution value contained a `${VAR}` pattern
 * 2. Resolving that pattern with current env vars produces the incoming value
 *
 * If a caller intentionally set a new value (different from what the env var
 * resolves to), the new value is kept as-is.
 */

import { resolveEnvVarsInString } from "./env-substitution.js";

const ENV_VAR_PATTERN = /\$\{[A-Z_][A-Z0-9_]*\}/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/**
 * Check if a string contains any `${VAR}` env var references.
 */
function hasEnvVarRef(value: string): boolean {
  return ENV_VAR_PATTERN.test(value);
}

/**
 * Deep-walk the incoming config and restore `${VAR}` references from the
 * pre-substitution parsed config wherever the resolved value matches.
 *
 * @param incoming - The resolved config about to be written
 * @param parsed - The pre-substitution parsed config (from the current file on disk)
 * @param env - Environment variables for verification
 * @returns A new config object with env var references restored where appropriate
 */
export function restoreEnvVarRefs(
  incoming: unknown,
  parsed: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  // If parsed has no env var refs at this level, return incoming as-is
  if (parsed === null || parsed === undefined) {
    return incoming;
  }

  // String leaf: check if parsed was a ${VAR} template that resolves to incoming
  if (typeof incoming === "string" && typeof parsed === "string") {
    if (hasEnvVarRef(parsed)) {
      const resolved = resolveEnvVarsInString(parsed, env, "null");
      if (resolved === incoming) {
        // The incoming value matches what the env var resolves to — restore the reference
        return parsed;
      }
    }
    return incoming;
  }

  // Arrays: walk element by element
  if (Array.isArray(incoming) && Array.isArray(parsed)) {
    return incoming.map((item, i) =>
      i < parsed.length ? restoreEnvVarRefs(item, parsed[i], env) : item,
    );
  }

  // Objects: walk key by key
  if (isPlainObject(incoming) && isPlainObject(parsed)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (key in parsed) {
        result[key] = restoreEnvVarRefs(value, parsed[key], env);
      } else {
        // New key added by caller — keep as-is
        result[key] = value;
      }
    }
    return result;
  }

  // Mismatched types or primitives — keep incoming
  return incoming;
}
