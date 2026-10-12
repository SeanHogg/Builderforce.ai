import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rehearsal guarantee has to hold BEFORE the loop starts.
 *
 * `shadowProvider` decorates the tool loop, but `prepareCloudRun` runs first — and on a
 * ticket with no PRD its default path drafts one (a paid LLM call), persists a `specs`
 * row, COMMITS `PRD.md` to the real ticket branch, records a `task_file_changes` row
 * and notifies the execution stream. Four escaping effects, all above the seam the
 * shadow provider wraps, so a rehearsal's very first act was a real commit.
 *
 * `ensureTaskPrd(..., readOnly)` is the fix, and this pins it: read-only READS an
 * existing PRD and never reaches the generate→persist→commit core.
 */

const ensureTaskPrdRecord = vi.fn();
const findTaskPrimarySpec = vi.fn();

vi.mock('../prd/taskPrd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../prd/taskPrd')>();
  return {
    ...actual,
    ensureTaskPrdRecord: (...a: unknown[]) => ensureTaskPrdRecord(...a),
    findTaskPrimarySpec: (...a: unknown[]) => findTaskPrimarySpec(...a),
  };
});

// First-draft grounding walks the bound workspace. Keep the write-path tests
// hermetic — no GitHub, no IDE snapshot — and still prove the brief is fed in.
vi.mock('../repos/commitFileAsPendingChange', () => ({
  resolveTicketRepoContext: async () => ({ ok: false, reason: 'unbound' }),
}));
vi.mock('./cloudAgent/ideWorkspaceCoding', () => ({
  resolveIdeWorkspaceForRun: async () => null,
  snapshotIdeWorkspace: async () => ({ files: [] }),
}));

const { ensureTaskPrd } = await import('./cloudAgent/prd');

const env = {} as never;
const db = {} as never;
const taskRow = { title: 'Add auth', description: null };
const call = (readOnly: boolean) =>
  ensureTaskPrd(env, db, 99, taskRow, 1, 2, 42, 'Ada', undefined, readOnly);

describe('ensureTaskPrd — readOnly (the rehearsal invariant)', () => {
  beforeEach(() => {
    ensureTaskPrdRecord.mockReset();
    findTaskPrimarySpec.mockReset();
  });

  it('readOnly returns an EXISTING PRD without invoking the write core', async () => {
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: '  # Existing PRD  ' });
    expect(await call(true)).toBe('# Existing PRD');
    // The assertion that matters: no draft, no spec row, no commit, no notification.
    expect(ensureTaskPrdRecord).not.toHaveBeenCalled();
  });

  it('readOnly on a ticket with NO PRD yields empty rather than creating one', async () => {
    findTaskPrimarySpec.mockResolvedValue(null);
    expect(await call(true)).toBe('');
    expect(ensureTaskPrdRecord).not.toHaveBeenCalled();
  });

  it('readOnly treats a blank PRD body as absent (and still writes nothing)', async () => {
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: '   ' });
    expect(await call(true)).toBe('');
    expect(ensureTaskPrdRecord).not.toHaveBeenCalled();
  });

  it('readOnly survives a lookup failure without falling back to the write path', async () => {
    findTaskPrimarySpec.mockRejectedValue(new Error('db down'));
    expect(await call(true)).toBe('');
    expect(ensureTaskPrdRecord).not.toHaveBeenCalled();
  });

  it('the DEFAULT path still ensures a PRD — the live run is unchanged', async () => {
    findTaskPrimarySpec.mockResolvedValue(null);
    ensureTaskPrdRecord.mockResolvedValue({ specId: 's1', prd: '# Drafted', status: 'reused' });
    expect(await call(false)).toBe('# Drafted');
    expect(ensureTaskPrdRecord).toHaveBeenCalledOnce();
  });

  it('reuses an existing PRD without a second draft or workspace snapshot', async () => {
    findTaskPrimarySpec.mockResolvedValue({ id: 's1', prd: '  # Existing  ' });
    expect(await call(false)).toBe('# Existing');
    expect(ensureTaskPrdRecord).not.toHaveBeenCalled();
  });

  it('grounds a first draft in the workspace snapshot (title+description is not enough)', async () => {
    findTaskPrimarySpec.mockResolvedValue(null);
    ensureTaskPrdRecord.mockResolvedValue({ specId: 's1', prd: '# Drafted', status: 'reused' });
    expect(await call(false)).toBe('# Drafted');
    const params = ensureTaskPrdRecord.mock.calls[0]?.[2] as { description: string };
    expect(params.description).toContain('No coding target bound: unbound');
  });

  it('the default path returns empty when no PRD could be produced', async () => {
    findTaskPrimarySpec.mockResolvedValue(null);
    ensureTaskPrdRecord.mockResolvedValue(null);
    expect(await call(false)).toBe('');
  });
});
