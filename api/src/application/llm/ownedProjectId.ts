/**
 * The tenant boundary every project-scoped catalog tool (blueprint, app manifest,
 * `runtime.agents.*`) runs before it reads or writes anything.
 *
 * A leaf module on purpose: the manifest catalog needs this check, and taking it from
 * the blueprint catalog pulled blueprint detection -> repos -> runtime -> `builtinMcpService`
 * into the manifest catalog's import graph — a cycle back into the CATALOG that spreads
 * both, which left `APP_BLUEPRINT_TOOLS` undefined when either catalog was loaded first.
 */
import { type BuiltinCtx } from './builtinToolContext';

type Json = Record<string, unknown>;

/**
 * The caller's own project, or a tool error. `projectId` is model-supplied and the
 * blueprint store is keyed by project alone, so this is the tenant boundary: a
 * foreign or unknown id is refused before anything is read or written.
 */
export async function ownedProjectId(ctx: BuiltinCtx, raw: unknown): Promise<number | Json> {
  const projectId = Number(raw);
  if (!Number.isFinite(projectId)) return { ok: false as const, error: 'Invalid projectId: must be a number' };
  try {
    await ctx.projects.getProject(projectId, ctx.tenantId);
    return projectId;
  } catch {
    return { ok: false as const, error: 'Project not found in this workspace', projectId };
  }
}
