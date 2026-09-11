/**
 * `skill` — skill authoring relayed from an IMAGE surface (capability `skill.author`).
 *
 * A container or Actions run that worked out a repeatable procedure can propose it as a
 * skill, exactly as a durable run can. The images hold no DB credentials — the reason
 * `memory`, `prd` and `coordinate` are relayed — so both verbs come back here.
 *
 * ── ONE AUTHORING PATH, NOT TWO ─────────────────────────────────────────────
 * This op does not re-implement `skill_propose` / `skill_list`. It runs the SAME tool
 * definitions the durable loop runs (resolved from `cloudToolRegistry`, so the argument
 * validation is the tool's own), against the SAME capability the durable provider
 * builds — `buildSkillAuthoringCapability`, which is the only way into `proposeSkill`.
 * So the invariant that makes agent-authored skills safe — a proposal ALWAYS lands as
 * a draft and only a human review can make it binding — holds on the image surfaces
 * for the same reason it holds on the durable one: there is no other writer to reach.
 *
 * The run identity (workspace, project, originating execution + ticket, agent label)
 * is stamped from the run context, never from the image's payload — the model cannot
 * attribute a draft to some other run or project.
 */
import type { Capability } from '@builderforce/agent-tools';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { buildSkillAuthoringCapability } from '../../skills/tenantSkillService';
import { cloudToolRegistry } from '../cloudAgentTools';
import { recordCloudToolEvent } from '../cloudToolEvents';
import type { ContainerOpHandler } from './containerOps';

/** The op's `action` → the tool the durable surface exposes for the same verb. */
const SKILL_ACTION_TOOLS: Readonly<Record<string, string>> = {
  propose: 'skill_propose',
  list: 'skill_list',
};

const SKILL_AUTHOR_CAPS: ReadonlySet<Capability> = new Set<Capability>(['skill.author']);

export const skillOp: ContainerOpHandler = async (deps) => {
  const { env, db, executionId, args, tenantId, taskId, projectId, cloudAgentRef, agentLabel } = deps;
  const action = typeof args.action === 'string' ? args.action : '';
  const toolName = SKILL_ACTION_TOOLS[action];
  if (!toolName) {
    return { status: 200, body: { ok: false, error: `unknown skill action '${action}' (expected 'propose' or 'list')` } };
  }
  const tool = cloudToolRegistry.get(toolName);
  if (!tool) return { status: 200, body: { ok: false, error: `skill tool '${toolName}' is not registered on this Worker` } };

  const skillAuthor = buildSkillAuthoringCapability({ env, db, tenantId, projectId, executionId, taskId, agentLabel });
  // Everything but `action` is the tool's own argument object, as the model wrote it.
  const { action: _action, ...toolArgs } = args;
  const tStart = Date.now();
  let result: Record<string, unknown>;
  try {
    const out = await tool.execute(toolArgs, { caps: { capabilities: SKILL_AUTHOR_CAPS, skillAuthor } });
    result = out.data;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/runtime/cloudAgent/skillOp.ts', operation: 'containerSkillOp',
      context: { details: { tenantId, executionId, action } },
    });
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  await recordCloudToolEvent(db, {
    tenantId, cloudAgentRef, executionId,
    toolName, category: 'tool',
    detail: action === 'propose' ? { slug: toolArgs.slug, name: toolArgs.name } : {},
    result: JSON.stringify(result).slice(0, 300), durationMs: Date.now() - tStart,
  });
  return { status: 200, body: result };
};
