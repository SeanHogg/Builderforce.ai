/**
 * The script fragments and the parameter every git tool shares — the read / sync / rewind
 * verbs (`git-tools.ts`) and the publish / cleanup verbs (`git-publish-tools.ts`) — so
 * "what is the base branch" and "what is `repo`" each have ONE answer.
 */

/** Resolve the remote's default branch into `$BASE`, falling back to `main`. Shared so
 *  "what is the base branch" has ONE answer across sync, commit, push and pull request. */
export const RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;

/** A commit identity for a clone that has none configured. */
export const IDENTITY_EMAIL = 'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"';
export const IDENTITY_NAME = 'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"';

/** The `repo` parameter, shared by every git tool — one description so the tools
 *  cannot drift into describing the same argument differently. */
export const REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.',
} as const;
