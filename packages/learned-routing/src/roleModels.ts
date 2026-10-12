/**
 * Multi-model role routing — map a call-purpose (or delivery) role onto a catalog
 * model id from operator config.
 *
 * WHY: one model for every role is the ROADMAP "Multi-model role routing" gap.
 * The ranker (`rankModelsForAction` / `rankConnectedForRole`) reorders a connected
 * pool by objective; it does not pin "verify runs on X". This resolver is that pin.
 *
 * PURE. No KV / DB / network. `env` is a bag the caller already holds (same
 * contract as `learnedRoutingEnabled`).
 *
 * Documented default: no pin. An unmapped / unknown / empty role falls through to
 * `defaultModel` when the caller supplied one, otherwise `undefined` so the
 * existing plan coding seed / learned ranker stands. Override: `byRole[role]`
 * wins whenever it is a non-empty string.
 *
 * Config keys on the env bag:
 *   ROLE_MODELS         JSON object of role → catalog model id, e.g.
 *                       `{"code":"claude-opus-4-8","verify":"gpt-4.1-mini",
 *                        "developer":"claude-opus-4-8","qa-tester":"gpt-4.1-mini"}`
 *   ROLE_MODEL_DEFAULT  fallback model id when the role has no override
 *
 * Keys are free-form so both spawn_agent call-purpose roles (plan / code / verify
 * / explore / chat / utility) and board delivery roles (developer / qa-tester /
 * architect) work. This package does not own either vocabulary.
 */

/** Env key: JSON object of role → catalog model id. */
export const ROLE_MODELS_ENV = 'ROLE_MODELS';

/** Env key: fallback model id when the role has no override. */
export const ROLE_MODEL_DEFAULT_ENV = 'ROLE_MODEL_DEFAULT';

/**
 * A role → model map plus the documented default.
 *
 * `defaultModel` is optional on purpose: this package does not own the catalog,
 * so it never invents a model id. Callers that already have a plan default pass
 * it here; callers that want "no pin" omit it.
 */
export interface RoleModelConfig {
  /** role → catalog model id. Empty / whitespace values are ignored. */
  byRole?: Readonly<Record<string, string>>;
  /** Documented default: used when `role` has no override. Undefined = no pin. */
  defaultModel?: string;
}

function trimId(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t ? t : undefined;
}

/**
 * Resolve the catalog model id for a role.
 *
 * `byRole[role]` wins when it is a non-empty string. Otherwise the documented
 * default is `config.defaultModel` (or `undefined` — no pin). Unknown, empty,
 * and missing roles all take the default; we never invent a model id from a
 * role name.
 */
export function resolveModelForRole(
  role: string | undefined | null,
  config: RoleModelConfig = {},
): string | undefined {
  const key = typeof role === 'string' ? role.trim() : '';
  const mapped = key ? trimId(config.byRole?.[key]) : undefined;
  return mapped ?? trimId(config.defaultModel);
}

/**
 * Parse an operator role → model map from an env bag.
 *
 * Empty / missing / malformed `ROLE_MODELS` → no overrides (every role uses
 * the documented default). An already-parsed object is accepted so tests and
 * in-process callers need not JSON-stringify.
 */
export function parseRoleModelConfig(env: unknown): RoleModelConfig {
  const bag = env && typeof env === 'object' ? (env as Record<string, unknown>) : {};
  const byRole = parseByRole(bag[ROLE_MODELS_ENV]);
  const defaultModel = trimId(bag[ROLE_MODEL_DEFAULT_ENV]);
  return {
    ...(byRole ? { byRole } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  };
}

function parseByRole(raw: unknown): Record<string, string> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return fromEntries(raw as Record<string, unknown>);
  }
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return fromEntries(parsed as Record<string, unknown>);
    }
  } catch {
    // not JSON — ignore; a typo must not invent mappings
  }
  return undefined;
}

function fromEntries(obj: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.trim();
    const id = trimId(v);
    if (key && id) out[key] = id;
  }
  return Object.keys(out).length ? out : undefined;
}
