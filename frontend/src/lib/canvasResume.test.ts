import { describe, expect, it } from 'vitest';
import {
  activeResumeRevision,
  createResumeFamily,
  deriveResume,
  promoteResumeToMaster,
  preserveResumeSourceForPatch,
  restoreResumeAsNew,
  selectResumeRevision,
  updateActiveResume,
} from './canvasResume';

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++]!;
};

describe('Canvas resume lineage', () => {
  it('keeps the uploaded original immutable while a derivative changes', () => {
    const original = createResumeFamily({ title: 'Uploaded.pdf', markdown: '# Original', now: '2026-08-11T00:00:00Z', idFactory: ids('original') });
    const derived = deriveResume(original, 'Product résumé', { now: '2026-08-11T01:00:00Z', idFactory: ids('derived') });
    const edited = updateActiveResume(derived, { markdown: '# Tailored', templateId: 'executive-taupe' }, '2026-08-11T02:00:00Z');
    expect(edited.revisions.find((revision) => revision.id === 'original')?.markdown).toBe('# Original');
    expect(activeResumeRevision(edited)).toMatchObject({ id: 'derived', markdown: '# Tailored', sourceRevisionId: 'original' });
    expect(activeResumeRevision(selectResumeRevision(edited, 'original')).markdown).toBe('# Original');
  });

  it('never edits the immutable original in place', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# Keep me', idFactory: ids('original') });
    expect(updateActiveResume(family, { markdown: '# Replaced' })).toEqual(family);
  });

  it('restores as a new head and promotes without changing source revisions', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const first = deriveResume(original, 'First', { idFactory: ids('first') });
    const restored = restoreResumeAsNew(first, 'original', 'Restored original', { idFactory: ids('restored') });
    const promoted = promoteResumeToMaster(restored, 'restored');
    expect(promoted.masterRevisionId).toBe('restored');
    expect(activeResumeRevision(promoted)).toMatchObject({ title: 'Restored original', sourceRevisionId: 'original' });
    expect(promoted.revisions).toHaveLength(3);
  });

  it('turns an agent content rewrite into a derivative patch', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Source', idFactory: ids('original') });
    const patch = preserveResumeSourceForPatch(
      { kind: 'resume', title: 'Uploaded', resumeFamily: family },
      { markdown: '# Tailored', templateId: 'sales-growth-emerald' },
      { now: '2026-08-11T03:00:00Z', idFactory: ids('agent-version') },
    );
    const next = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(next.revisions).toHaveLength(2);
    expect(next.revisions[0]?.markdown).toBe('# Source');
    expect(activeResumeRevision(next)).toMatchObject({ id: 'agent-version', markdown: '# Tailored', sourceRevisionId: 'original' });
    expect(patch.content).toBe('# Tailored');
  });
});
