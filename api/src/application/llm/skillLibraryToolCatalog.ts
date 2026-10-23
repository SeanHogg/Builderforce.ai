/**
 * The SKILL LIBRARY tool — `skills.read`, spread into `builtinMcpService`'s `CATALOG`.
 *
 * ── WHY IT IS A PLATFORM TOOL ────────────────────────────────────────────────────
 * The catalog the gateway serves (`GET /v1/mcp/tools`, `POST /mcp`) is what the Brain
 * reads on the web, in VS Code and in Rovr, what the creation canvas and the Studio read,
 * what an external MCP client reads, and — through `CLOUD_AGENT_PLATFORM_TOOLS` and the
 * images' `builtin_*` relay — what a cloud or container run is handed. One row here is
 * therefore Agent Skills support on every one of those surfaces, with no second engine:
 * every load goes through `application/skills/skillLibrary`.
 *
 * ── PROGRESSIVE DISCLOSURE ON A TOOL HOST ─────────────────────────────────────────
 * The spec's first level is a catalog the agent always sees. A cloud run gets it as a
 * prompt block; every catalog consumer gets it in THIS tool's description, which
 * {@link withSkillCatalog} rewrites per workspace when the gateway lists tools — so a
 * client needs no change at all to learn which skills exist. A workspace with no skills
 * is not offered the tool: an empty library is not worth a schema in every request.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { readLibrarySkill, skillLibraryCatalog, type LibrarySkillSummary } from '../skills/skillLibrary';
import { projectIdForExecution } from '../runtime/previewSessions';
import { requireEnv as requireToolEnv, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';
import { advertisedName } from './toolNaming';
import type { McpToolEntry } from './mcpExtensionService';

type Json = Record<string, unknown>;

export const SKILLS_READ_TOOL = 'skills.read';

const BASE_DESCRIPTION =
  'Load an Agent Skill — a reusable, reviewed procedure for a specific kind of task. '
  + 'Call it with `name` to get the skill\'s instructions and the list of files bundled with it, and follow those instructions before acting. '
  + 'Call it with `name` and `path` to load one bundled file (a script, a reference) when the instructions point at it. '
  + 'An unknown name comes back with the names that exist.';

const requireEnv = (ctx: BuiltinCtx): Env => requireToolEnv(
  ctx,
  'Loading a skill needs a signed-in workspace session and is not available in this context.',
);

export const SKILL_LIBRARY_TOOLS: BuiltinTool[] = [
  {
    tool: SKILLS_READ_TOOL,
    mutates: false,
    description: BASE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name, exactly as the catalog lists it (kebab-case).' },
        path: { type: 'string', description: 'Optional. A bundled file to load, relative to the skill folder (e.g. "references/REFERENCE.md").' },
      },
      required: ['name'],
    },
    run: async (ctx: BuiltinCtx, a: Json) => {
      const env = requireEnv(ctx);
      const path = typeof a.path === 'string' ? a.path : null;
      // A run is scoped to its ticket's project, so it loads only what its catalog showed;
      // a caller with no run (a Brain chat, a workspace key) has no project to scope to.
      const projectId = ctx.executionId != null ? await projectIdForExecution(ctx.db, ctx.tenantId, ctx.executionId) : undefined;
      return readLibrarySkill(env, ctx.db, ctx.tenantId, String(a.name ?? ''), path, projectId);
    },
  },
];

/** Keeps a long library from crowding the rest of the catalog out of the model's context. */
const DESCRIPTION_ENTRY_MAX = 240;

/** The tool description with the workspace's catalog appended (level one, inline). */
export function describeSkillReadTool(skills: readonly LibrarySkillSummary[]): string {
  const lines = skills.map((s) => {
    const d = s.description.replace(/\s+/g, ' ').trim();
    return `- ${s.name}: ${d.length > DESCRIPTION_ENTRY_MAX ? `${d.slice(0, DESCRIPTION_ENTRY_MAX - 1)}…` : d}`;
  });
  return `${BASE_DESCRIPTION}\n\nSkills available in this workspace — when a task matches one, load it first:\n${lines.join('\n')}`;
}

const ADVERTISED = advertisedName(SKILLS_READ_TOOL);

/**
 * Give the advertised `skills.read` row this workspace's catalog, or drop it when the
 * library is empty. Called by the gateway on the built-in source it already fetched,
 * so every transport (REST and JSON-RPC) advertises the same thing.
 *
 * Best-effort by design: a failed catalog read leaves the tool with its base
 * description rather than failing the whole tool list, because every other tool on
 * the surface is still correct.
 */
export async function withSkillCatalog(env: Env, db: Db, tenantId: number, tools: McpToolEntry[]): Promise<McpToolEntry[]> {
  const index = tools.findIndex((t) => t.name === ADVERTISED);
  if (index === -1) return tools;
  let skills: LibrarySkillSummary[];
  try {
    skills = await skillLibraryCatalog(env, db, tenantId);
  } catch {
    return tools;
  }
  if (skills.length === 0) return tools.filter((_, i) => i !== index);
  const out = tools.slice();
  out[index] = { ...tools[index]!, description: describeSkillReadTool(skills) };
  return out;
}
