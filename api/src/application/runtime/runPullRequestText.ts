/**
 * runPullRequestText — the title and body of the pull request a run leaves behind.
 *
 * ONE builder for every way that PR comes to exist: `finalizeCloudRun` opening it at the end, the finalize
 * adopting the draft the run opened early for a build (`adoptRunDraftPr`, whose placeholder text is replaced
 * with this), and the early draft itself (`draftPullRequestText`, whose TITLE is this one's).
 */
export function runPullRequestText(a: {
  taskId: number; taskTitle: string; agentLabel: string; writtenPaths: Iterable<string>; ciVerified: boolean;
}): { title: string; body: string } {
  return {
    title: `Task #${a.taskId}: ${a.taskTitle}`,
    body: `Changes for task #${a.taskId}, by ${a.agentLabel}.${[...a.writtenPaths].length ? ` Files: ${[...a.writtenPaths].join(', ')}.` : ''}\n\n${a.ciVerified
      ? '> ✅ **CI was green in-run** on the ticket-branch HEAD (combined commit status / check-runs). Re-check CI on this PR before merge — opening it or a later push can still go red.'
      : '> ⚠ **Not verified in-agent.** This serverless executor has no shell and ran no local build, type-check, lint, or tests. CI on this PR is the source of truth — do not merge on the agent\'s summary alone.'}`,
  };
}

const DRAFT_BODY_TAIL = ' so the repository\'s pull_request CI builds this branch while the run is still in progress. It has no shell to build in.';

/** The placeholder text of the draft opened mid-run so the repository's `pull_request` CI builds the branch: the run's title, a draft body. */
export function draftPullRequestText(a: { taskId: number; taskTitle: string; agentLabel: string }): { title: string; body: string } {
  const { title } = runPullRequestText({ ...a, writtenPaths: [], ciVerified: false });
  return { title, body: `Draft opened by ${a.agentLabel} for task #${a.taskId}${DRAFT_BODY_TAIL}` };
}

/** Whether a PR body is the platform's draft placeholder for this task, whoever the agent was (a human's own body never matches). */
export function isDraftPullRequestBody(body: string | null | undefined, taskId: number): boolean {
  const text = body ?? '';
  return text.startsWith('Draft opened by ') && text.endsWith(` for task #${taskId}${DRAFT_BODY_TAIL}`);
}
