/**
 * The AGENT PERSONA tool — "who is Ada, and how does she think?", spread into
 * `builtinMcpService`'s `CATALOG`.
 *
 * ── WHY A MODEL NEEDS THIS ───────────────────────────────────────────────────────
 * Operator decision (2026-09-15): when the Brain does work locally instead of dispatching
 * it, the sub-agents it spawns should BE the workspace's agents. `spawn_agent { as_agent }`
 * makes that happen, and this row is how a model checks, before or instead of delegating,
 * what a given teammate actually brings — the role, the title, and the compiled persona the
 * child would run under. It is also the honest answer to "which of our agents should do
 * this?", which otherwise gets answered from a name alone.
 *
 * ── READ-ONLY, AND A REFUSAL THAT TEACHES ────────────────────────────────────────
 * An unknown agent returns `{ ok: false, error, available }` rather than throwing. A model
 * told "no agent named Kevin" guesses again; told which agents exist, it picks one. The
 * refusal is the cheaper half of the loop, so it is the half that carries the information.
 *
 * ── ONE COMPILER ─────────────────────────────────────────────────────────────────
 * The brief comes from `application/agent/agentPersonaBrief`, which is a resolver over the
 * SAME lowering every other surface runs an agent on. Nothing here composes a persona
 * string of its own — two descriptions of one agent is how a workspace ends up with two
 * Adas who disagree.
 */
import { requireEnv as requireToolEnv, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';
import { listTenantAgentNames, resolveAgentPersonaBrief } from '../agent/agentPersonaBrief';
import type { Env } from '../../env';

type Json = Record<string, unknown>;

const S = { type: 'string' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const str = (v: unknown): string => String(v ?? '');

/**
 * Compiling a persona reads the workspace's agent rows through the cached base, which
 * needs the Worker env. A caller that did not thread it gets this sentence rather than a
 * `TypeError` on `undefined.AUTH_CACHE_KV` three frames down.
 */
const requireEnv = (ctx: BuiltinCtx): Env => requireToolEnv(
  ctx,
  'Reading an agent\'s persona needs a signed-in workspace session and is not available in this context.',
);

/** Names offered back on a miss. Enough to make the next call correct, not a roster dump. */
const MAX_SUGGESTED = 20;

export const AGENT_PERSONA_TOOLS: BuiltinTool[] = [
  {
    tool: 'cloud_agents.persona_brief',
    mutates: false,
    description:
      'The persona of one of this workspace\'s agents — its name, title and the compiled brief (role, bio, skills, personality) it runs under. '
      + '`agent` accepts the agent id OR its name ("Ada"), matched case-insensitively. '
      + 'Read this to decide WHICH teammate should take a piece of work, or to see what a child would inherit before delegating with spawn_agent { as_agent }. '
      + 'An unknown agent comes back as { ok: false } listing the agents that do exist — pick one of those rather than guessing again.',
    parameters: obj({ agent: S }, ['agent']),
    run: async (ctx: BuiltinCtx, a: Json) => {
      const env = requireEnv(ctx);
      const agent = str(a.agent).trim();
      if (!agent) return { ok: false, error: 'agent is required — pass an agent id or its name' };

      const brief = await resolveAgentPersonaBrief(env, ctx.tenantId, agent);
      if (brief) return { ok: true, ...brief };

      return {
        ok: false,
        error: `no agent named/with id "${agent}" in this workspace`,
        available: await listTenantAgentNames(env, ctx.tenantId, MAX_SUGGESTED),
      };
    },
  },
];
