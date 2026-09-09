/**
 * The DELIVERY tool catalog — "where is each ticket's code?", spread into
 * `builtinMcpService`'s `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Asked "which tickets have pending code changes?", an agent had no tool for the
 * question. `tasks.list` reports lane and progress, `manager.stalled_tickets` reports
 * why a ticket stopped moving — neither says whether the ticket's code ever reached
 * the base branch. So the only route to an answer was the shell: enumerate every
 * branch, then `git rev-list <base>..<branch> --count` once per branch, then correlate
 * the results back to tickets by name. Measured on a real VSIX session doing exactly
 * that: 100+ branches, 500 KB of tool output, five results truncated before the model
 * saw them, context exhausted before a verdict. The evidence was all server-side the
 * whole time; only the question was missing.
 *
 * ── WHY IT IS ITS OWN CATALOG MODULE ─────────────────────────────────────────────
 * `builtinMcpService` is already ~4,200 lines. The convention for a domain that can
 * declare its own rows is to declare them in its own module and be spread in — the
 * career tools established it (see `careerToolCatalog.ts`) — so this follows it rather
 * than adding a 4,246th line to the file everyone has to edit.
 *
 * ── MEASURE, DON'T NARRATE ───────────────────────────────────────────────────────
 * Every row returns counts, per-ticket evidence and an `instruction`; none of them
 * writes prose. The caller of an MCP tool on this platform is itself a language model,
 * and a tool that writes the paragraph does the caller's job worse than the caller
 * would, with none of the conversation's context.
 */
import {
  MAX_TICKETS_PER_BATCH,
  readPendingChangesForTickets,
  type TicketPendingChangesResult,
} from '../task/ticketPendingChangesPort';
import { needsDeliveryAttention, type PendingChangesState } from '../task/ticketPendingChanges';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { requireEnv as requireToolEnv, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';
import { maskSecurityTasks } from './builtinTaskVisibility';
import type { Env } from '../../env';

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the main catalog uses) ------------
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const B = { type: 'boolean' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });
const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);

/**
 * These rows compare a branch against its base at the provider, which needs the
 * decrypted repo credential and therefore the Worker env. A caller that did not
 * thread it gets this sentence rather than a `TypeError` several frames down.
 */
const requireEnv = (ctx: BuiltinCtx): Env => requireToolEnv(
  ctx,
  'Reading a ticket\'s delivery state compares its branch against the repository, which needs a signed-in workspace session with a connected repo. It is not available in this context.',
);

/**
 * Severity order for the response. `abandoned` first because it is the state that
 * looks finished and is not: a ticket whose PR closed unmerged reads as `done` with
 * 100% progress everywhere else in the product.
 */
const STATE_ORDER: readonly PendingChangesState[] = [
  'abandoned', 'unmerged', 'in_review', 'unknown', 'landed', 'none',
];

/** Tickets considered per call before the caller is told to narrow. Bounds the DB
 *  read; the far tighter bound on PROVIDER calls lives in the port. */
const MAX_TICKETS_SCANNED = 500;

interface TicketRow {
  id: number;
  key: unknown;
  title: unknown;
  status: unknown;
  taskType: unknown;
  gitBranch: string | null;
  githubPrUrl: unknown;
  githubPrNumber: unknown;
  restricted: boolean;
}

/** Project the ticket fields this catalog reports, dropping everything else so a
 *  200-ticket answer stays inside a model's budget. */
function toTicketRow(plain: Record<string, unknown>): TicketRow {
  return {
    id: Number(plain.id),
    key: plain.key,
    title: plain.title,
    status: plain.status,
    taskType: plain.taskType,
    gitBranch: typeof plain.gitBranch === 'string' ? plain.gitBranch : null,
    githubPrUrl: plain.githubPrUrl,
    githubPrNumber: plain.githubPrNumber,
    restricted: plain.restricted === true,
  };
}

export const DELIVERY_TOOLS: BuiltinTool[] = [
  {
    tool: 'tickets.pending_changes',
    mutates: false,
    description:
      'Answer "which tickets have code that has NOT landed on the base branch?" for a project — the ticket property to read INSTEAD of shelling out to git. '
      + 'Compares each ticket\'s branch against its base and returns one state per ticket: '
      + '`abandoned` (commits exist but the PR was CLOSED without merging — looks finished, is not), '
      + '`unmerged` (commits exist and no PR was ever opened), '
      + '`in_review` (commits exist behind an open/draft PR), '
      + '`landed` (the PR merged — nothing outstanding), '
      + '`none` (no branch, or nothing ahead of base), '
      + '`unknown` (the branch could not be read — NOT a claim that it is clean). '
      + 'Each row carries `hasPendingChanges`, `aheadCount` and a `reason` sentence naming the evidence. '
      + 'By default only tickets WITH pending changes are returned; pass includeSettled=true for the full picture. '
      + 'Filter with projectId (required) and optionally status. Do NOT enumerate branches with run_command to answer this — that is what this tool replaces.',
    parameters: obj({ projectId: N, status: S, includeSettled: B, limit: N }, ['projectId']),
    run: async (ctx, a) => {
      const env = requireEnv(ctx);
      const projectId = num(a.projectId);
      const statusFilter = a.status != null ? str(a.status) : null;
      const includeSettled = a.includeSettled === true;
      const limit = Math.max(1, Math.min(Number(a.limit) || 50, 200));

      const all = await ctx.tasks.listTasks(ctx.tenantId, projectId);
      let plains = all.map((t) => t.toPlain() as unknown as Record<string, unknown>);
      if (statusFilter) plains = plains.filter((r) => r.status === statusFilter);
      // SECURITY tickets are masked (surfaced, not hidden) for a caller without
      // clearance — the same shared gate the board and tasks.list use.
      plains = await maskSecurityTasks(ctx, plains);

      const scanned = plains.slice(0, MAX_TICKETS_SCANNED).map(toTicketRow).filter((r) => Number.isFinite(r.id));
      // A masked ticket is reported as restricted rather than compared: resolving its
      // branch would leak the very repository path the mask exists to withhold.
      const visible = scanned.filter((r) => !r.restricted);

      const verdicts = await readPendingChangesForTickets(
        env,
        ctx.db,
        integrationCredentialSecret(env),
        ctx.tenantId,
        visible.map((r) => ({ taskId: r.id, gitBranch: r.gitBranch })),
      );

      const summary: Record<PendingChangesState, number> = {
        abandoned: 0, unmerged: 0, in_review: 0, unknown: 0, landed: 0, none: 0,
      };
      const rows = visible.map((row) => {
        const verdict: TicketPendingChangesResult | undefined = verdicts.get(row.id);
        const state: PendingChangesState = verdict?.state ?? 'unknown';
        summary[state] += 1;
        return {
          id: row.id,
          key: row.key,
          title: row.title,
          status: row.status,
          taskType: row.taskType,
          state,
          hasPendingChanges: verdict?.hasPendingChanges ?? false,
          needsAttention: needsDeliveryAttention(state),
          branch: verdict?.branch ?? row.gitBranch,
          aheadCount: verdict?.aheadCount ?? null,
          truncated: verdict?.truncated ?? false,
          reason: verdict?.reason ?? 'delivery state could not be resolved',
          prUrl: row.githubPrUrl ?? null,
          prNumber: row.githubPrNumber ?? null,
        };
      });

      const reported = (includeSettled ? rows : rows.filter((r) => r.hasPendingChanges || r.state === 'unknown'))
        .sort((x, y) => {
          const byState = STATE_ORDER.indexOf(x.state) - STATE_ORDER.indexOf(y.state);
          return byState !== 0 ? byState : (y.aheadCount ?? 0) - (x.aheadCount ?? 0);
        })
        .slice(0, limit);

      const restricted = scanned.filter((r) => r.restricted).length;
      return {
        projectId,
        scanned: scanned.length,
        compared: visible.length,
        ...(restricted > 0 ? { restricted } : {}),
        summary,
        tickets: reported,
        returned: reported.length,
        truncated: plains.length > MAX_TICKETS_SCANNED,
        instruction:
          'Report `abandoned` tickets first: their code exists on a branch and their pull request was closed without merging, so they read as finished everywhere else. '
          + '`unknown` means the branch could not be read — say so; do NOT report it as clean or as having no changes. '
          + 'An `aheadCount` with `truncated: true` is a floor, not a total. '
          + `At most ${MAX_TICKETS_PER_BATCH} tickets are compared against their branches per call; when more need comparing, narrow with status and ask again.`,
      };
    },
  },
];
