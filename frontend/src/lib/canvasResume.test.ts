import { describe, expect, it } from 'vitest';
import {
  activeResumeRevision,
  createResumeFamily,
  deriveResume,
  deleteResumeRevision,
  initializeResumeFromPatch,
  originalResumeRevision,
  promoteResumeToMaster,
  preserveResumeSourceForPatch,
  restoreResumeAsNew,
  renderResumeMarkdown,
  resumeDocumentFromJson,
  selectResumeRevision,
  updateActiveResume,
  updateResumeFamilySettings,
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

  it('persists privacy, archive, and watch settings on the family', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const updated = updateResumeFamilySettings(family, { privacy: 'recruiter_only', archivedAt: '2026-08-11T04:00:00Z', watched: true });
    expect(updated).toMatchObject({ privacy: 'recruiter_only', archivedAt: '2026-08-11T04:00:00Z', watched: true });
    expect(family).toMatchObject({ privacy: 'private', archivedAt: null, watched: false });
  });

  it('protects original and master while deleting an ordinary derived version', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const first = deriveResume(original, 'First', { idFactory: ids('first') });
    const second = deriveResume(first, 'Second', { idFactory: ids('second') });
    expect(deleteResumeRevision(second, 'original')).toEqual(second);
    const deleted = deleteResumeRevision(second, 'second');
    expect(deleted.revisions.map((revision) => revision.id)).toEqual(['original', 'first']);
    expect(deleted.activeRevisionId).toBe('original');
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

  it('accepts a canonical agent document without persisting a parallel field', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Source', document: { basics: { name: 'Source' } }, idFactory: ids('original') });
    const patch = preserveResumeSourceForPatch(
      { kind: 'resume', title: 'Uploaded', resumeFamily: family },
      { resumeDocument: { basics: { name: 'Tailored' }, skills: [{ name: 'Leadership' }] } },
      { idFactory: ids('structured-agent-version') },
    );
    const next = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(activeResumeRevision(next).document?.basics?.name).toBe('Tailored');
    expect(activeResumeRevision(next).markdown).toContain('# Tailored');
    expect(patch.resumeDocument).toBeUndefined();
    expect(next.revisions[0]?.document?.basics?.name).toBe('Source');
  });

  it('initializes an agent-authored canonical resume as a selectable family', () => {
    const patch = initializeResumeFromPatch('Generated', { resumeDocument: { basics: { name: 'Grace Hopper' }, skills: [{ name: 'Compilers' }] } });
    const family = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(family.revisions).toHaveLength(1);
    expect(activeResumeRevision(family)).toMatchObject({ kind: 'original', title: 'Generated' });
    expect(patch.markdown).toContain('# Grace Hopper');
    expect(patch.resumeDocument).toBeUndefined();
  });

  it('retains JSON Resume extension fields and renders canonical sections', () => {
    const document = resumeDocumentFromJson({
      basics: { name: 'Ada Lovelace', label: 'Engineer', email: 'ada@example.test', xProfile: { handle: 'ada' } },
      work: [{ id: 'work-1', name: 'Analytical Engines', position: 'Programmer', startDate: '1842', highlights: ['Published the first algorithm'], securityClearance: 'custom' }],
      education: [{ institution: 'Self-directed', area: 'Mathematics' }],
      skills: [{ name: 'Computing', keywords: ['Algorithms'] }],
      interests: [{ name: 'Mathematics', keywords: ['Number theory'] }],
      references: [{ name: 'Charles Babbage', reference: 'Exceptional analytical work.' }],
      customSection: [{ preserved: true }],
    });
    expect(document).not.toBeNull();
    expect(document?.customSection).toEqual([{ preserved: true }]);
    expect(document?.work?.[0]?.securityClearance).toBe('custom');
    expect(renderResumeMarkdown(document!)).toContain('## Experience');
    expect(renderResumeMarkdown(document!)).toContain('Published the first algorithm');
    expect(renderResumeMarkdown(document!)).toContain('## Interests');
    expect(renderResumeMarkdown(document!)).toContain('Exceptional analytical work.');
  });

  it('renders an empty canonical document without hanging or inventing content', () => {
    expect(renderResumeMarkdown({})).toBe('');
  });

  it('honors section visibility and ordering without deleting structured content', () => {
    const document = {
      basics: { name: 'Ada', summary: 'Hidden summary' },
      work: [{ position: 'Engineer', name: 'Engines' }],
      skills: [{ name: 'Algorithms' }],
      builderforceLayout: { sectionOrder: ['skills', 'work'], hiddenSections: ['summary'] },
    };
    const markdown = renderResumeMarkdown(document);
    expect(markdown).not.toContain('Hidden summary');
    expect(markdown.indexOf('## Skills')).toBeLessThan(markdown.indexOf('## Experience'));
    expect(document.basics.summary).toBe('Hidden summary');
  });

  it('regenerates rendered markdown after a structured edit', () => {
    const family = createResumeFamily({
      title: 'Ada',
      markdown: '# Ada',
      document: { basics: { name: 'Ada' }, skills: [{ name: 'Mathematics' }] },
      idFactory: ids('original'),
    });
    const derived = deriveResume(family, 'Structured edit', { idFactory: ids('derived') });
    const updated = updateActiveResume(derived, { document: { basics: { name: 'Ada' }, skills: [{ name: 'Computing', keywords: ['Algorithms'] }] } });
    expect(activeResumeRevision(updated).markdown).toContain('**Computing**: Algorithms');
    expect(activeResumeRevision(updated).structuredStale).toBe(false);
    expect(originalResumeRevision(updated).document?.skills?.[0]?.name).toBe('Mathematics');
  });
});
