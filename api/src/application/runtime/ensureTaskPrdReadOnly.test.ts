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

vi.mock('../prd/taskPrd', () => ({
  ensureTaskPrdRecord: (...a: unknown[]) => ensureTaskPrdRecord(...a),
  findTaskPrimarySpec: (...a: unknown[]) => findTaskPrimarySpec(...a),
  appendTaskPrdRevision: vi.fn(),
}));

const { ensureTaskPrd } = await import('./cloudAgentEngine');

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
    ensureTaskPrdRecord.mockResolvedValue({ specId: 's1', prd: '# Drafted', status: 'reused' });
    expect(await call(false)).toBe('# Drafted');
    expect(ensureTaskPrdRecord).toHaveBeenCalledOnce();
    // 'reused' short-circuits before the commit, so the read-only lookup is not used.
    expect(findTaskPrimarySpec).not.toHaveBeenCalled();
  });

  it('the default path returns empty when no PRD could be produced', async () => {
    ensureTaskPrdRecord.mockResolvedValue(null);
    expect(await call(false)).toBe('');
  });
});
