/**
 * Model roles — WHAT KIND OF CALL this is, so a delegation can pick a model suited
 * to the work instead of inheriting whatever the parent happened to be pinned to.
 *
 * Deliberately a closed, tiny set of CALL-PURPOSE tags, orthogonal to the arc stage
 * (idea/make/run/measure/reach) a canvas session reports: a role changes within a
 * single run — a coding agent that delegates a read-only investigation is still one
 * "make"-stage session, but the delegated call is `explore`, not `code`.
 *
 * Lives in this package (not the api) because both the cloud engine and the
 * extension host declare the SAME `spawn_agent` tool and need the SAME vocabulary
 * for it — the api's own `modelRoles.ts` re-exports this and adds the objective/
 * catalog-tier resolution, which is api-specific and has no business in a package
 * with zero dependencies.
 */

export type ModelRole = 'plan' | 'code' | 'verify' | 'explore' | 'chat' | 'utility';

export const MODEL_ROLES: readonly ModelRole[] = ['plan', 'code', 'verify', 'explore', 'chat', 'utility'];

/** One line per role, shown to the delegating MODEL in the `spawn_agent` tool schema
 *  so it picks deliberately rather than defaulting to whatever it is running as. */
export const MODEL_ROLE_DESCRIPTIONS: Readonly<Record<ModelRole, string>> = {
  plan: 'Deciding an approach or breaking work down — no code written yet.',
  code: 'Writing or editing code. Default when the delegated work is itself an edit.',
  verify: 'Checking work already done — reading test/build output, reviewing a diff.',
  explore: "Read-only investigation — locating, searching, summarising. Default when `read_only` is left true.",
  chat: 'A conversational answer with no task-shaped work behind it.',
  utility: 'Small, mechanical, low-stakes work — formatting, extraction, a lookup.',
};

const ROLE_SET = new Set<string>(MODEL_ROLES);

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && ROLE_SET.has(value);
}
