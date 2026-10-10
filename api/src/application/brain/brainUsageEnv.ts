import type { Env } from '../../env';

/**
 * The env a Brain call's usage row is recorded with: the REAL request env, with
 * the operator key the call priced against.
 *
 * The usage row used to be written with a fabricated `{ OPENROUTER_API_KEY }`
 * env. `recordUsageRow` chooses the ledger's database from the env
 * (`resolveUsageDatabase` → `NEON_TRANSACTIONAL_DATABASE_URL`), and the stub had
 * no such binding, so every Brain summary / agent reply fell back to the CORE
 * handle — the copy of `llm_usage_log` no meter reads, and the reason core still
 * gained rows (`brain_summary`, 2026-10-05) after the telemetry cutover.
 */
export function brainUsageEnv(callEnv: Env, apiKey: string | undefined): Env {
  return { ...callEnv, OPENROUTER_API_KEY: apiKey } as Env;
}
