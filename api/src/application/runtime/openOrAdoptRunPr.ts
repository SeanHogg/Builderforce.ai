/**
 * openOrAdoptRunPr — how the run-end finalize comes to HAVE the run's pull request.
 *
 * Atomic single-PR claim (0140), via the ONE task PR-open step the Done-drag path also uses
 * (`openClaimedPullRequest`): claim BEFORE the external create so this inline run-end finalize can't open a duplicate
 * PR alongside a concurrent human Done-drag. A lost claim is either another path's PR, or THIS run's own early draft
 * (a run with no sandbox opens one to get a build — `ci/draftPrForCi`), which is taken out of draft and finalized as
 * if opened just now (`adoptRunDraftPr`). A claim this call RETOOK (the opener died before recording) whose create
 * resolved to a draft is the same draft, unrecorded: it is adopted with `recovered`. A failed create has already
 * released its own claim.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { TicketRepoContext } from '../repos/commitFileAsPendingChange';
import { openClaimedPullRequest } from '../repos/openTaskPullRequest';
import { adoptRunDraftPr } from './adoptRunDraftPr';

type Claim = Awaited<ReturnType<typeof openClaimedPullRequest>>;

export async function openOrAdoptRunPr(db: Db, a: {
  tenantId: number; cloudAgentRef: string | undefined; executionId: number; taskId: number;
  repoCtx: TicketRepoContext | null;
  /** Whether this run should open a PR at all (it wrote files and was not cancelled). */
  open: boolean;
  /** The finalize's own title and body (`runPullRequestText`). */
  text: { title: string; body: string };
}): Promise<{ opened: Claim | { ok: true; number: number; url: string } | null; ownDraft: { number: number; url: string; rowId: string } | null }> {
  const { repoCtx } = a;
  const taken: { retook?: boolean; at?: Date } = {};
  const claim: Claim | null = repoCtx && a.open
    ? await openClaimedPullRequest(db, a.tenantId, a.taskId, {
      provider: repoCtx.provider, host: repoCtx.host, owner: repoCtx.owner, repo: repoCtx.repo,
      token: repoCtx.token, head: repoCtx.branch, base: repoCtx.base, ...a.text,
    }, taken).catch((): Claim => ({ ok: false, claimLost: true }))
    : null;
  const recovered = claim && claim.ok && claim.existing && claim.draft === true && taken.retook
    ? { number: claim.number, url: claim.url } : undefined;
  const ownDraft = repoCtx && claim && ('claimLost' in claim || recovered)
    ? await adoptRunDraftPr(db, {
      tenantId: a.tenantId, cloudAgentRef: a.cloudAgentRef, executionId: a.executionId, taskId: a.taskId, repoCtx, text: a.text,
      ...(recovered ? { recovered } : {}),
    }).catch(() => null)
    : null;
  return { opened: ownDraft ? { ok: true, number: ownDraft.number, url: ownDraft.url } : claim, ownDraft };
}
