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
export const MODEL_ROLES = ["plan", "code", "verify", "explore", "chat", "utility"];
/** One line per role, shown to the delegating MODEL in the `spawn_agent` schema so it
 *  picks deliberately rather than defaulting to whatever it is running as. */
export const MODEL_ROLE_DESCRIPTIONS = {
    plan: "Deciding an approach or breaking work down — no code written yet.",
    code: "Writing or editing code. The default when no role is named.",
    verify: "Checking work already done — reading test/build output, reviewing a diff.",
    explore: "Investigation — locating, searching, summarising.",
    chat: "A conversational answer with no task-shaped work behind it.",
    utility: "Small, mechanical, low-stakes work — formatting, extraction, a lookup.",
};
/**
 * What each role is FOR, as a number routing can use: +1 pulls toward the strongest model,
 * -1 toward the cheapest, 0 leaves the tenant's own order alone. CODE is written by the
 * strongest model on offer; ANALYSIS runs on the tenant's order; checking and reading lead
 * with the cheapest capable model. Here, beside the vocabulary, so the gateway's ordering
 * (`@builderforce/model-router`) and a host choosing a child's model read ONE table.
 */
export const MODEL_ROLE_OBJECTIVE = {
    code: 1,
    plan: 0,
    chat: 0,
    verify: -0.5,
    explore: -1,
    utility: -1,
};
/**
 * Does this role lead with the cheaper models? A delegation of that role must not inherit
 * its owner's model as a hint: a verify child handed the coder's model checks on the most
 * expensive tier, which is the cost the role exists to avoid.
 */
export function roleLeansCheap(role) {
    return isModelRole(role) && MODEL_ROLE_OBJECTIVE[role] < 0;
}
const ROLE_SET = new Set(MODEL_ROLES);
export function isModelRole(value) {
    return typeof value === "string" && ROLE_SET.has(value);
}
/**
 * The role a delegation's turns are routed as. A model that named one gets it;
 * otherwise `code` — a child is a clone of its owner and does the slice end to end.
 * ONE rule for every surface that backs `spawn_agent`.
 */
export function delegationRole(raw) {
    return isModelRole(raw) ? raw : "code";
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
export const DELEGATION_DELIVERY_ROLES = {
    code: "developer",
    verify: "qa-tester",
};
/**
 * The on-demand teammate a slice runs as when no named agent holds its delivery role. A
 * Developer for a code slice, a QA Tester for a verify slice — the role, not a person, so
 * the work is never attributed to an agent who did not do it.
 */
export const DELEGATION_ROLE_PERSONAS = {
    developer: {
        name: "Developer",
        brief: "Developer — implements the slice it is handed: reads the code it touches, makes the change within its scope, follows the repository's existing patterns, and reports exactly which files it changed and what is left.",
    },
    "qa-tester": {
        name: "QA Tester",
        brief: "QA Tester — verifies the slice it is handed: exercises the change against its acceptance criteria, reports what passed and what failed with the evidence, and never fixes what it is testing.",
    },
};
export function staffDelegation(agent, role) {
    const needed = DELEGATION_DELIVERY_ROLES[role];
    if (!needed || !agent.roleKeys || agent.roleKeys.includes(needed))
        return { kind: "as-agent" };
    const persona = DELEGATION_ROLE_PERSONAS[needed] ?? { name: needed, brief: needed };
    const holds = agent.roleKeys.length ? agent.roleKeys.join(", ") : "no delivery role";
    return {
        kind: "on-demand",
        persona,
        note: `${agent.name} holds ${holds}, not ${needed}, so this ${role} slice ran as an on-demand ${persona.name} sub-agent and is not attributed to ${agent.name}. To staff it as a teammate, give that agent the ${needed} role or create one with builtin_cloud_agents_create (roleKeys: ["${needed}"]).`,
    };
}
//# sourceMappingURL=modelRoles.js.map