/**
 * draftPrForCi — give a shell-less run the build its repository only runs for a pull request.
 *
 * Without a sandbox the finish gate's only build is the branch's CI (`pollBranchCi`). A repo whose
 * workflows trigger on `pull_request` reports `none` for a branch with no PR, so such a run could
 * never get a build. When the verdict is `none` and the repo has a pull_request workflow, the run's
 * PR is opened early as a DRAFT through the ONE task PR-open step (`openClaimedPullRequest` — the
 * same claim the run-end finalize uses) and the verdict becomes `pending`, which the existing
 * pending-block loop polls again. Everything else keeps the verdict it was given.
 *
 * "Is the draft already open" is read from the DURABLE record (`draftOpen`), never from this
 * instance's memory: a durable run builds fresh finish gates on every tick, and a later tick must
 * see the earlier tick's draft as CI that is expected, not as a repository with none.
 *
 * The caller passes the ports only for a run that has no sandbox. PURE: no infrastructure imports;
 * the real ports are bound in `draftPrPorts.ts`.
 */
import type { CommitCiVerdict } from './pollCommitCiStatus';

/** The timeline event the early draft is recorded under (telemetry only; the identity is the PR row). */
export const DRAFT_PR_TOOL = 'ci.draft_pr';

/** What the early draft needs from the world; bound for real by `draftPrPorts`. */
export interface DraftPrPorts {
  /** Whether this task's platform-opened draft PR is already open on the run's branch (the durable record). */
  draftOpen(): Promise<boolean>;
  /** Whether any workflow of the repo is triggered by a pull request. */
  hasPullRequestWorkflow(): Promise<boolean>;
  /** Open the run's PR as a draft; `exists` when the task's PR is already open (or being opened) by another path. */
  openDraft(): Promise<{ ok: true; number: number; url: string } | { ok: false; exists: boolean; reason: string }>;
  /** Timeline note. */
  record(result: string, detail: Record<string, unknown>): Promise<void>;
}

const waiting = (v: CommitCiVerdict, text: string, url?: string): CommitCiVerdict =>
  ({ ...v, status: 'pending', summary: text, ...(url ? { url } : {}) });

/** The verdict the finish gate should act on. */
export async function ciVerdictWithDraftPr(verdict: CommitCiVerdict, a: { ports: DraftPrPorts }): Promise<CommitCiVerdict> {
  if (verdict.status !== 'none') return verdict;
  const { ports } = a;
  const at = verdict.sha ? verdict.sha.slice(0, 7) : 'HEAD';
  // An earlier tick already opened it: CI is expected on it, and nothing is read or opened again.
  if (await ports.draftOpen()) return waiting(verdict, `The run's draft PR is open; waiting for its pull_request CI on ${at}.`);
  if (!(await ports.hasPullRequestWorkflow())) return verdict;
  const opened = await ports.openDraft();
  if (!opened.ok) {
    if (!opened.exists) await ports.record(`Could not open a draft PR to trigger pull_request CI: ${opened.reason}`.slice(0, 300), { opened: false });
    return verdict;
  }
  await ports.record(`Opened draft PR #${opened.number} so the repository's pull_request CI runs on this branch (the run has no sandbox to build in).`, { opened: true, number: opened.number, url: opened.url });
  return waiting(verdict, `Opened draft PR #${opened.number}; waiting for its pull_request CI to start on ${at}.`, opened.url);
}
