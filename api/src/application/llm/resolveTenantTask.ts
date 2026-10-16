/**
 * Resolve a tenant ticket by numeric id, then by `#<n>:` / `#<n> ` title.
 *
 * Lives in its own module so callers (and tests) do not pull in
 * `builtinToolContext`'s JWT / replay graph — that load is what made
 * `builtinMcpService.test.ts` lose its TaskService mock when both files
 * ran in one vitest command.
 */
import { NotFoundError } from '../../domain/shared/errors';
import { advertisedName } from './toolNaming';

/** The slice of BuiltinCtx this lookup needs. Structural so we never import the heavy module. */
export type TenantTaskLookup = {
  tenantId: number;
  tasks: {
    getTask: (id: number) => Promise<{ projectId: number; toPlain: () => unknown }>;
    listTasks: (
      tenantId: number,
      projectId?: number,
      includeArchived?: boolean,
    ) => Promise<Array<{ toPlain: () => unknown }> | null | undefined>;
  };
  projects: {
    getProject: (projectId: number, tenantId: number) => Promise<unknown>;
  };
};

/**
 * True when a ticket title is a hash-ref to `n`: `#2346: …` or `#2346 …`.
 * Superstrings (`#23460:`) must not match — the delimiter after the digits is required.
 */
export function titleStartsWithHashRef(title: string, n: number): boolean {
  return title.startsWith(`#${n}:`) || title.startsWith(`#${n} `);
}

function isTaskNotFound(error: unknown, id: number): boolean {
  return error instanceof NotFoundError && error.message === `Task '${id}' not found`;
}

function hashRefMatches(listed: Array<{ toPlain: () => unknown }>, n: number) {
  return listed.filter((t) => {
    const title = (t.toPlain() as { title?: unknown }).title;
    return typeof title === 'string' && titleStartsWithHashRef(title, n);
  });
}

function describeHashRefMatches(matches: Array<{ toPlain: () => unknown }>): string {
  return matches.map((t) => {
    const p = t.toPlain() as { id?: unknown; title?: unknown };
    return `${p.id} "${String(p.title ?? '')}"`;
  }).join('; ');
}

function notFoundNamingMatches(id: number, matches: Array<{ toPlain: () => unknown }>): NotFoundError {
  const err = new NotFoundError('Task', id);
  err.message = `Task '${id}' not found. Matching titled ticket(s): ${describeHashRefMatches(matches)}. Retry ${advertisedName('tasks.get')} with that id.`;
  return err;
}

async function loadTenantTask(ctx: TenantTaskLookup, id: number) {
  const task = await ctx.tasks.getTask(id);
  await ctx.projects.getProject(task.projectId, ctx.tenantId);
  return task;
}

/**
 * When the numeric id 404s, look up a ticket whose title starts with `#<n>:`
 * or `#<n> ` in this tenant (models pass a gap number because tickets are
 * titled `#2346: …` while the board id is different).
 *
 * Prefer returning the unique match. If several titles match, or the unique match
 * cannot be loaded, 404 NAMING the matching id/title so the caller can retry.
 */
export async function resolveTenantTask(ctx: TenantTaskLookup, id: number) {
  try {
    return await loadTenantTask(ctx, id);
  } catch (error) {
    if (!isTaskNotFound(error, id)) throw error;
    const listed = (await ctx.tasks.listTasks(ctx.tenantId, undefined, true)) ?? [];
    const matches = hashRefMatches(listed, id);
    if (matches.length === 1) {
      const matchId = Number((matches[0]!.toPlain() as { id: unknown }).id);
      if (Number.isFinite(matchId) && matchId !== id) {
        try {
          return await loadTenantTask(ctx, matchId);
        } catch {
          throw notFoundNamingMatches(id, matches);
        }
      }
      throw notFoundNamingMatches(id, matches);
    }
    if (matches.length > 1) throw notFoundNamingMatches(id, matches);
    throw error;
  }
}
