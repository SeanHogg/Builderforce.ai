import { describe, expect, it, vi } from 'vitest';
import { ciVerdictWithDraftPr, type DraftPrPorts } from './draftPrForCi';
import type { CommitCiVerdict } from './pollCommitCiStatus';

const none: CommitCiVerdict = { status: 'none', sha: 'abcdef1234', count: 0, summary: 'No CI checks', failed: [] };

function ports(over: Partial<DraftPrPorts> = {}) {
  return {
    draftOpen: vi.fn(async () => false),
    hasPullRequestWorkflow: vi.fn(async () => true),
    openDraft: vi.fn(async () => ({ ok: true as const, number: 7, url: 'https://x/pull/7' })),
    record: vi.fn(async () => undefined),
    ...over,
  } as DraftPrPorts & Record<'draftOpen' | 'hasPullRequestWorkflow' | 'openDraft' | 'record', ReturnType<typeof vi.fn>>;
}

describe('ciVerdictWithDraftPr', () => {
  it('opens a draft PR when the repo builds only for a pull request, and reports pending', async () => {
    const p = ports();
    const out = await ciVerdictWithDraftPr(none, { ports: p });
    expect(out.status).toBe('pending');
    expect(p.openDraft).toHaveBeenCalledTimes(1);
    expect(p.record).toHaveBeenCalledWith(expect.stringContaining('draft PR #7'), expect.objectContaining({ opened: true }));
  });

  it('an already-open draft is pending without reading the workflows or opening anything', async () => {
    const p = ports({ draftOpen: vi.fn(async () => true) });
    const out = await ciVerdictWithDraftPr(none, { ports: p });
    expect(out.status).toBe('pending');
    expect(p.hasPullRequestWorkflow).not.toHaveBeenCalled();
    expect(p.openDraft).not.toHaveBeenCalled();
  });

  it('does not reopen when another path already has the task\'s PR, and says nothing', async () => {
    const p = ports({ openDraft: vi.fn(async () => ({ ok: false as const, exists: true, reason: 'x' })) });
    expect(await ciVerdictWithDraftPr(none, { ports: p })).toBe(none);
    expect(p.record).not.toHaveBeenCalled();
  });

  it('records a failed open and keeps the verdict', async () => {
    const p = ports({ openDraft: vi.fn(async () => ({ ok: false as const, exists: false, reason: 'provider 500' })) });
    expect(await ciVerdictWithDraftPr(none, { ports: p })).toBe(none);
    expect(p.record).toHaveBeenCalledWith(expect.stringContaining('provider 500'), { opened: false });
  });

  it('leaves a non-none verdict, or a repo with no pull_request workflow, alone', async () => {
    const p = ports();
    const green = { ...none, status: 'success' as const };
    expect(await ciVerdictWithDraftPr(green, { ports: p })).toBe(green);
    expect(p.draftOpen).not.toHaveBeenCalled();
    const q = ports({ hasPullRequestWorkflow: vi.fn(async () => false) });
    expect(await ciVerdictWithDraftPr(none, { ports: q })).toBe(none);
    expect(q.openDraft).not.toHaveBeenCalled();
  });
});
