/**
 * Which checkout a run works in by DEFAULT, when the open folder CONTAINS checkouts
 * rather than being one (`/code/` holding `/code/app` and `/code/api`).
 *
 * Without a default every git call and every shell command at such a root failed first
 * ("not a git repository", or a build run in the wrong directory) and the model then
 * prefixed `cd X &&` to everything for the rest of the run. The surface resolves the
 * default ONCE per run with this pure function and hands it to the shell
 * (`ShellCapability.defaultRepo`); the git tools and `run_command` use it.
 *
 * Order (first rule that decides wins):
 *   1. an explicit `repo` argument;
 *   2. a repo-relative path in the request or the call (`app/src/x.ts`) whose first
 *      segment is a candidate checkout;
 *   3. the chat's project repository, matched to a candidate's `origin` owner/repo;
 *   4. the only candidate there is.
 * Nothing decides ⇒ undefined, and the tools keep naming the candidates.
 */

import { inferRepoFromPath, safeRepoArg } from "./git-repo-scope.js";

/** A top-level checkout under the workspace root, with its `origin` when known. */
export interface RepoCheckout {
  name: string;
  origin?: { owner: string; repo: string };
}

/** One of the chat's project repositories (`GET /api/repos/projects/:id/repositories`). */
export interface ProjectRepoRef {
  owner: string;
  repo: string;
  isDefault?: boolean;
}

export interface ResolveDefaultRepoInput {
  candidates: readonly (string | RepoCheckout)[];
  /** An explicit `repo` the caller already chose. */
  explicit?: string;
  /** Workspace-relative paths named by the request or the call's arguments. */
  paths?: readonly string[];
  projectRepos?: readonly ProjectRepoRef[];
}

const lower = (s: string): string => s.toLowerCase();

/** The candidate names, in order, each matched case-insensitively (Windows folders). */
function checkoutsOf(candidates: ResolveDefaultRepoInput["candidates"]): RepoCheckout[] {
  return candidates
    .map((c) => (typeof c === "string" ? { name: c } : c))
    .filter((c) => !!safeRepoArg(c.name));
}

/** The one distinct value, or undefined when there are none or several. */
function only(values: readonly string[]): string | undefined {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

export function resolveDefaultRepo(input: ResolveDefaultRepoInput): string | undefined {
  const explicit = safeRepoArg(input.explicit);
  if (explicit) return explicit;
  const checkouts = checkoutsOf(input.candidates);
  if (checkouts.length === 0) return undefined;
  const byName = new Map(checkouts.map((c) => [lower(c.name), c.name]));

  const named = (input.paths ?? [])
    .map((p) => inferRepoFromPath(p))
    .map((seg) => (seg ? byName.get(lower(seg)) : undefined))
    .filter((n): n is string => !!n);
  const fromPath = only(named);
  if (fromPath) return fromPath;

  const repos = input.projectRepos ?? [];
  if (repos.length > 0) {
    const matches = (r: ProjectRepoRef): string[] =>
      checkouts
        .filter((c) => c.origin && lower(c.origin.owner) === lower(r.owner) && lower(c.origin.repo) === lower(r.repo))
        .map((c) => c.name);
    const preferred = repos.filter((r) => r.isDefault).flatMap(matches);
    const fromProject = only(preferred) ?? only(repos.flatMap(matches));
    if (fromProject) return fromProject;
  }

  return checkouts.length === 1 ? checkouts[0]!.name : undefined;
}

/**
 * Repo-relative paths written in free text (`update Builderforce.ai/docs/x.md`) — the
 * request's half of rule 2. Only tokens with at least one separator count; a bare word
 * is not a path. Quotes, backticks and trailing punctuation are stripped.
 */
export function pathsInText(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const raw of text.split(/[\s"'`()<>[\]{},;]+/)) {
    const token = raw.replace(/[.:!?]+$/, "");
    if (/^[\w.@-]+(?:[\\/][\w.@-]+)+[\\/]?$/.test(token) && !token.startsWith("..")) out.push(token);
  }
  return out;
}
