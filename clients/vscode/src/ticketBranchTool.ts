/**
 * `review_ticket_branches` — the editor's one-call ticket branch review: every ticket in
 * the active project matched to its git branch, with ahead/behind counts, a no-checkout
 * merge check and the PR state, grouped by what should happen next. Branches no ticket
 * claims are listed too. Composes the platform ticket list (`bfApi`) with local git
 * facts (`gitBranchFacts.ts`); the verdicts are `ticketBranchReview.ts`.
 *
 * Read-only: it never checks out, merges or deletes. The one ref it touches is the
 * `origin` remote-tracking set (`git fetch`), so the review reflects what has landed.
 */

import type * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { listTasksForReview } from "./bfApi";
import type { ToolDef } from "./fileTools";
import { GitRepo, mapLimit, type BranchComparison, type BranchRef } from "./gitBranchFacts";
import {
  branchForTicket,
  classify,
  formatReview,
  isOpenTicket,
  taskIdFromBranch,
  VERDICT_ORDER,
  type BranchVerdict,
  type ReviewRow,
  type ReviewTicket,
  type UntrackedBranch,
} from "./ticketBranchReview";

/** Git processes in flight at once. */
const GIT_CONCURRENCY = 8;
/** Unclaimed branches compared per call, newest first — older ones are counted, not compared. */
const MAX_UNTRACKED_COMPARED = 80;

export const TICKET_BRANCH_REVIEW_TOOL = "review_ticket_branches";

/** A `repo` subdirectory argument that stays inside the workspace. */
function safeRepo(repo: unknown): string | null {
  if (typeof repo !== "string" || !repo.trim()) return null;
  const r = repo.trim().split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return r && !r.split("/").includes("..") && !path.isAbsolute(r) && /^[\w./@-]+$/.test(r) ? r : null;
}

/** The immediate subdirectories that are git checkouts — the remedy when the root is not one. */
async function checkoutsUnder(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    if (await fs.stat(path.join(root, e.name, ".git")).then(() => true, () => false)) out.push(e.name);
  }
  return out;
}

function asVerdict(v: unknown): BranchVerdict | undefined {
  return typeof v === "string" && (VERDICT_ORDER as readonly string[]).includes(v) ? (v as BranchVerdict) : undefined;
}

export function ticketBranchReviewToolDef(secrets: vscode.SecretStorage, projectId: number): ToolDef {
  return {
    name: TICKET_BRANCH_REVIEW_TOOL,
    description:
      "Review the active project's tickets against their git branches in ONE call — use this instead of `git branch` / `git log main..X` loops and a tasks.get per ticket. For each ticket: its branch, commits ahead/behind the base, whether it merges cleanly or conflicts (checked without a checkout, with the conflicted files), and its PR state — grouped as ready / conflicts / merged_pr_leftover / in_base / branch_missing / no_branch, with the next step for each group. Also lists branches with unmerged commits that no ticket claims. Read-only (it only fetches origin). Pass `repo` when the open folder contains several checkouts.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: 'Subdirectory holding the repository, when the open folder CONTAINS checkouts (e.g. "Builderforce.ai"). Omit when the workspace root is the repo.' },
        scope: { type: "string", enum: ["open", "all"], description: "`open` (default): tickets not done/cancelled. `all`: every ticket with a branch, archived included." },
        baseBranch: { type: "string", description: "Branch to compare against. Defaults to origin's default branch." },
        only: { type: "string", enum: VERDICT_ORDER.filter((v) => v !== "no_branch"), description: "Return just this group, in full (when the summary said rows were not shown)." },
        fetch: { type: "boolean", description: "Fetch origin first so the review reflects what has landed (default true)." },
      },
    },
    mutating: false,
    execute: async (args, root) => {
      const repoArg = safeRepo(args.repo);
      if (args.repo != null && !repoArg) return JSON.stringify({ ok: false, error: "`repo` must be a subdirectory inside the workspace." });
      const repoDir = repoArg ? path.join(root, repoArg) : root;
      const git = new GitRepo(repoDir);
      if (!(await git.isRepo())) {
        const candidates = repoArg ? [] : await checkoutsUnder(root);
        return JSON.stringify({
          ok: false,
          error: `${repoArg ?? "The workspace root"} is not a git repository.`,
          ...(candidates.length ? { checkouts: candidates, note: `Re-run with \`repo\` set to one of: ${candidates.join(", ")}.` } : {}),
        });
      }
      const fetched = args.fetch === false ? false : await git.fetch();
      const base = await git.resolveBase(typeof args.baseBranch === "string" && args.baseBranch.trim() ? args.baseBranch.trim() : undefined);
      if (!base) return JSON.stringify({ ok: false, error: "Could not resolve a base branch (no origin/HEAD, main or master). Pass `baseBranch`." });

      const scopeAll = args.scope === "all";
      const [tasks, branches] = await Promise.all([listTasksForReview(secrets, projectId, scopeAll), git.branches()]);
      const branchByName = new Map<string, BranchRef>(branches.map((b) => [b.name, b]));
      const baseName = base.replace(/^origin\//, "");

      const tickets: ReviewTicket[] = tasks
        .filter((t) => (scopeAll ? true : isOpenTicket(t.status)))
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          gitBranch: t.gitBranch ?? null,
          prNumber: t.githubPrNumber ?? null,
          prState: t.prState ?? null,
        }));
      const branchNames = new Set(branchByName.keys());
      const planned = tickets.map((ticket) => ({ ticket, branch: branchForTicket(ticket, branchNames) }));
      // `scope: all` is about branches — a closed ticket that never had one is noise.
      const inScope = scopeAll ? planned.filter((p) => p.branch) : planned;

      const rows: ReviewRow[] = await mapLimit(inScope, GIT_CONCURRENCY, async ({ ticket, branch }) => {
        const ref = branch ? branchByName.get(branch) : undefined;
        const comparison: BranchComparison | undefined = ref ? await git.compare(base, ref.ref) : undefined;
        return { ticket, branch, comparison, remoteOnly: ref?.remoteOnly, verdict: classify(ticket, branch, !!ref, comparison) };
      });

      // Branches no reviewed ticket claims, newest first, that carry commits the base lacks.
      const claimed = new Set(rows.map((r) => r.branch).filter(Boolean) as string[]);
      const unclaimed = branches
        .filter((b) => !claimed.has(b.name) && b.name !== baseName)
        .sort((a, b) => b.committedAt.localeCompare(a.committedAt))
        .slice(0, MAX_UNTRACKED_COMPARED);
      const compared = await mapLimit(unclaimed, GIT_CONCURRENCY, async (b) => ({ b, comparison: await git.compare(base, b.ref) }));
      const untracked: UntrackedBranch[] = compared
        .filter(({ comparison }) => comparison.ahead > 0 && comparison.merge !== "in_base")
        .map(({ b, comparison }) => ({ name: b.name, comparison, committedAt: b.committedAt, impliedTaskId: taskIdFromBranch(b.name) }));

      return JSON.stringify(formatReview({ repo: repoArg ?? ".", base, fetched, rows, untracked, only: asVerdict(args.only) }));
    },
  };
}
