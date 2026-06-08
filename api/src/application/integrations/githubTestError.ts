/**
 * githubStatusMessage — turn a non-OK GitHub REST status into an actionable
 * connectivity-test message.
 *
 * Shared by every GitHub "Test" probe (the integration-key auth check in
 * integrationRoutes and the repo-accessibility check in repoRoutes) so the two
 * surfaces never drift on how a 401/403/404 is explained to the operator. A bare
 * "GitHub API returned 404" is useless — for a repo probe a 404 means the repo
 * is private/wrong, not that GitHub is down — so the message depends on context.
 */
export type GitHubProbeContext = 'token' | 'repo';

export function githubStatusMessage(
  status: number,
  ctx: GitHubProbeContext,
  where?: string,
): string {
  const at = where ? ` (${where})` : '';
  switch (status) {
    case 401:
      return 'Token rejected (401) — the personal access token is invalid or expired.';
    case 403:
      return ctx === 'repo'
        ? `Forbidden (403)${at} — token is valid but lacks access. If the org enforces SSO, authorize the token for that org.`
        : 'Forbidden (403) — token is valid but lacks the required scopes (or is rate-limited).';
    case 404:
      return ctx === 'repo'
        ? `Repository not found or not visible to this token (404)${at}. Check the owner/repo spelling, and for a private repo grant the token "repo" scope (classic PAT) or read access to this repository (fine-grained PAT).`
        : 'GitHub returned 404 — verify the token and that api.github.com is reachable.';
    default:
      return `GitHub API returned ${status}`;
  }
}
