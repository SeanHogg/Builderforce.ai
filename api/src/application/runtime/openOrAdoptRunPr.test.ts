/**
 * How the finalize comes to have the run's PR: opened, adopted from its own early draft (lost claim), or adopted from
 * a dead claim's unrecorded draft - and ONLY when the claim it took was a retake of a dead one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ open: vi.fn(), adopt: vi.fn() }));
vi.mock('../repos/openTaskPullRequest', () => ({ openClaimedPullRequest: h.open }));
vi.mock('./adoptRunDraftPr', () => ({ adoptRunDraftPr: h.adopt }));

import { openOrAdoptRunPr } from './openOrAdoptRunPr';

const db = {} as never;
const repoCtx = { provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'bf/task-3', base: 'main', repoId: 'r1', segmentId: null, projectId: 2 };
const text = { title: 'T', body: 'B' };
const a = { tenantId: 1, cloudAgentRef: undefined, executionId: 9, taskId: 3, repoCtx, open: true, text };
const adopted = { number: 7, url: 'https://x/pull/7', rowId: 'row-1' };

/** An open step that took the claim as a retake (or not), reporting it through the out-parameter like the real one. */
const opens = (result: unknown, retook: boolean) => async (...args: unknown[]) => { Object.assign(args[4] as object, { retook, at: new Date() }); return result; };

beforeEach(() => { vi.clearAllMocks(); h.adopt.mockResolvedValue(adopted); });

describe('openOrAdoptRunPr', () => {
  it('opens a PR normally: nothing adopted', async () => {
    h.open.mockImplementation(opens({ ok: true, number: 5, url: 'u' }, false));
    expect(await openOrAdoptRunPr(db, a)).toEqual({ opened: { ok: true, number: 5, url: 'u' }, ownDraft: null });
    expect(h.adopt).not.toHaveBeenCalled();
  });

  it('a lost claim adopts the run\'s own early draft (no recovery)', async () => {
    h.open.mockResolvedValue({ ok: false, claimLost: true });
    expect(await openOrAdoptRunPr(db, a)).toMatchObject({ ownDraft: adopted, opened: { ok: true, number: 7 } });
    expect(h.adopt.mock.calls[0]![1]).not.toHaveProperty('recovered');
  });

  it('regression: a RETAKEN claim whose create resolved to a draft adopts it as recovered, so it is marked ready with the final text', async () => {
    h.open.mockImplementation(opens({ ok: true, number: 11, url: 'https://x/pull/11', existing: true, draft: true }, true));
    expect(await openOrAdoptRunPr(db, a)).toMatchObject({ ownDraft: adopted });
    expect(h.adopt).toHaveBeenCalledWith(db, expect.objectContaining({ text, recovered: { number: 11, url: 'https://x/pull/11' } }));
  });

  it('regression: MAJOR 1 - a draft the create resolved to WITHOUT a retaken claim is not ours: no adoption, the PR is left as found', async () => {
    h.open.mockImplementation(opens({ ok: true, number: 11, url: 'u', existing: true, draft: true }, false));
    expect(await openOrAdoptRunPr(db, a)).toEqual({ opened: { ok: true, number: 11, url: 'u', existing: true, draft: true }, ownDraft: null });
    expect(h.adopt).not.toHaveBeenCalled();
  });

  it('opens nothing when the run should not (no files, or cancelled)', async () => {
    expect(await openOrAdoptRunPr(db, { ...a, open: false })).toEqual({ opened: null, ownDraft: null });
    expect(h.open).not.toHaveBeenCalled();
  });
});
