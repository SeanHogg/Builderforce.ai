import { describe, expect, it } from 'vitest';
import { projectPublicResumeFamily } from './publicResumeProjection';

describe('projectPublicResumeFamily', () => {
  it('publishes only the master snapshot and strips private source storage metadata', () => {
    const projected = projectPublicResumeFamily({
      version: 1, privacy: 'public', originalRevisionId: 'original', activeRevisionId: 'draft', masterRevisionId: 'master',
      defaultTemplateId: 'hired-default', viewZoom: 80, archivedAt: '2026-01-01', watched: true,
      revisions: [
        { id: 'original', kind: 'original', markdown: 'private original', sourceFile: { key: 'tenant/private.pdf' } },
        { id: 'draft', kind: 'derived', markdown: 'unpublished draft' },
        { id: 'master', kind: 'derived', markdown: 'published', sourceRevisionId: 'original', sourceFile: { key: 'tenant/source.docx' } },
      ],
    });
    expect(projected?.revisions).toEqual([{ id: 'master', kind: 'original', markdown: 'published', sourceRevisionId: null }]);
    expect(projected).toMatchObject({ originalRevisionId: 'master', activeRevisionId: 'master', masterRevisionId: 'master', archivedAt: null, watched: false });
  });

  it('rejects non-public and empty families', () => {
    expect(projectPublicResumeFamily({ privacy: 'private', revisions: [{ id: 'one' }] })).toBeNull();
    expect(projectPublicResumeFamily({ privacy: 'public', revisions: [] })).toBeNull();
  });
});
