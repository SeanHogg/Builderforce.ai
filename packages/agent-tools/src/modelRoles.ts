/**
 * Model roles — WHAT KIND OF CALL this is, so routing can pick a model suited to the
 * work instead of one global provider order for every call.
 *
 * A closed set of CALL-PURPOSE tags, orthogonal to the arc stage (idea/make/run/
 * measure/reach) a canvas session reports: a role changes within a single run — a
 * coding agent that delegates a read-only investigation is still one "make"-stage
 * session, but the delegated call is `explore`, not `code`.
 *
 * Lives in this zero-dependency package because every surface that declares
 * `spawn_agent` (the cloud engine, the extension host) needs the SAME vocabulary. The
 * api adds the objective each role implies on top (`api/src/application/llm/modelRoles.ts`).
 */

export type ModelRole = "plan" | "code" | "verify" | "explore" | "chat" | "utility";

export const MODEL_ROLES: readonly ModelRole[] = ["plan", "code", "verify", "explore", "chat", "utility"];

/** One line per role, shown to the delegating MODEL in the `spawn_agent` schema so it
 *  picks deliberately rather than defaulting to whatever it is running as. */
export const MODEL_ROLE_DESCRIPTIONS: Readonly<Record<ModelRole, string>> = {
  plan: "Deciding an approach or breaking work down — no code written yet.",
  code: "Writing or editing code. Default when the delegated work is itself an edit.",
  verify: "Checking work already done — reading test/build output, reviewing a diff.",
  explore: "Read-only investigation — locating, searching, summarising. Default when `read_only` is left true.",
  chat: "A conversational answer with no task-shaped work behind it.",
  utility: "Small, mechanical, low-stakes work — formatting, extraction, a lookup.",
};

const ROLE_SET = new Set<string>(MODEL_ROLES);

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

/**
 * The role a delegation runs as. A model that named one gets it; otherwise its
 * `read_only` choice already typed the intent — reading is an investigation, writing
 * is an edit. ONE rule for every surface that backs `spawn_agent`.
 */
export function delegationRole(raw: unknown, readOnly: boolean): ModelRole {
  return isModelRole(raw) ? raw : readOnly ? "explore" : "code";
}

/**
 * The DELIVERY role (the board's role key) a named agent must hold to take a delegated
 * slice of this kind. A code slice runs as a Developer and a verify slice as QA. The other
 * call purposes (planning, reading, chat) are open to any teammate.
 *
 * WHY: `as_agent` used to accept any agent for any slice, so a run could hand a code
 * change to the workspace's Product Manager. The work then reads as hers in the chat and
 * on the ticket, which is the role-blind assignment the board's role capability exists to
 * prevent. One table, read by every surface that backs `spawn_agent { as_agent }`.
 */
export const DELEGATION_DELIVERY_ROLES: Readonly<Partial<Record<ModelRole, string>>> = {
  code: "developer",
  verify: "qa-tester",
};

/** One agent as the persona check sees it: its name and the role keys it can act as.
 *  `roleKeys` absent ⇒ the host cannot tell, and the check does not filter. */
export interface DelegationPersonaRoles {
  name: string;
  roleKeys?: readonly string[];
}

/**
 * Why `agent` may NOT take a slice of `role`, or null when it may. The refusal names the
 * role it needs and the roles the agent does hold, so the parent picks a capable teammate
 * instead of guessing again.
 */
export function delegationRoleRefusal(agent: DelegationPersonaRoles, role: ModelRole): string | null {
  const needed = DELEGATION_DELIVERY_ROLES[role];
  if (!needed || !agent.roleKeys) return null;
  if (agent.roleKeys.includes(needed)) return null;
  const holds = agent.roleKeys.length ? agent.roleKeys.join(", ") : "no delivery role";
  return `${agent.name} cannot take a ${role} slice: it needs a ${needed} and ${agent.name} holds ${holds}. Run it AS a ${needed}-capable agent (builtin_cloud_agents_persona_brief with role=${needed} lists them), or omit as_agent.`;
}
