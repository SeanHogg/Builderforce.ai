import { describe, expect, it } from 'vitest';
import { activeResumeRevision, createResumeFamily, deriveResume, updateActiveResume } from './canvasResume';
import { compareResumeDocuments, mergeResumeAsNewVersion, mergeResumeDocuments } from './canvasResumeDiff';

describe('Canvas resume comparison and merge', () => {
  const source = {
    basics: { name: 'Ada', summary: 'Original summary', email: 'ada@example.test' },
    work: [{ id: 'work-1', name: 'Engines', position: 'Programmer', highlights: ['Original'] }],
    skills: [{ name: 'Mathematics' }],
    customExtension: { retained: true },
  };
  const target = {
    basics: { name: 'Ada', summary: 'Tailored summary', email: 'ada@example.test' },
    work: [{ id: 'work-1', name: 'Engines', position: 'Senior Programmer', highlights: ['Tailored'] }],
    skills: [{ name: 'Algorithms' }, { name: 'Leadership' }],
    customExtension: { target: true },
  };

  it('reports canonical section changes and scalar basics fields', () => {
    const differences = compareResumeDocuments(source, target);
    expect(differences.filter((difference) => difference.changed).map((difference) => difference.section)).toEqual(['basics', 'work', 'skills']);
    expect(differences.find((difference) => difference.section === 'basics')?.fields).toEqual([
      { path: 'basics.summary', source: 'Original summary', target: 'Tailored summary' },
    ]);
    expect(differences.find((difference) => difference.section === 'skills')).toMatchObject({ sourceCount: 1, targetCount: 2 });
  });

  it('merges selected sections while retaining target extensions', () => {
    const merged = mergeResumeDocuments(target, source, new Set(['basics', 'skills']));
    expect(merged.basics?.summary).toBe('Original summary');
    expect(merged.skills).toEqual(source.skills);
    expect(merged.work).toEqual(target.work);
    expect(merged.customExtension).toEqual({ target: true });
  });

  it('executes merge as a new revision without mutating either input', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# Ada', document: source, idFactory: () => 'original' });
    let family = deriveResume(original, 'Tailored', { idFactory: () => 'tailored' });
    family = updateActiveResume(family, { document: target });
    const merged = mergeResumeAsNewVersion(family, family.revisions[0]!, family.revisions[1]!, new Set(['skills']), 'Merged', { idFactory: () => 'merged' });
    expect(merged.revisions).toHaveLength(3);
    expect(activeResumeRevision(merged)).toMatchObject({ id: 'merged', title: 'Merged', sourceRevisionId: 'tailored' });
    expect(activeResumeRevision(merged).document?.skills).toEqual(source.skills);
    expect(merged.revisions[0]?.document?.skills).toEqual(source.skills);
    expect(merged.revisions[1]?.document?.skills).toEqual(target.skills);
  });
});
