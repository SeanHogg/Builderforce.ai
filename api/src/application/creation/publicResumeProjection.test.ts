import { describe, expect, it } from 'vitest';
import { projectPublicResumeFamily } from './publicResumeProjection';

/**
 * Every fixture here carries `title` AND `markdown` on each revision, because
 * `resumeFamilyFromValue` requires both: a revision missing either is dropped,
 * and a family with no surviving revision projects to null. Leaving them off
 * made this file's "rejects" cases pass for the wrong reason — the family was
 * being rejected as unparseable long before privacy was ever consulted.
 */
describe('projectPublicResumeFamily', () => {
  it('publishes only the master snapshot and strips private source storage metadata', () => {
    const projected = projectPublicResumeFamily({
      version: 1, privacy: 'public', originalRevisionId: 'original', activeRevisionId: 'draft', masterRevisionId: 'master',
      defaultTemplateId: 'hired-default', viewZoom: 80, watched: true,
      revisions: [
        { id: 'original', kind: 'original', title: 'Resume', markdown: 'private original', sourceFile: { key: 'tenant/private.pdf' } },
        { id: 'draft', kind: 'derived', title: 'Resume', markdown: 'unpublished draft' },
        { id: 'master', kind: 'derived', title: 'Resume', markdown: 'published', sourceRevisionId: 'original', sourceFile: { key: 'tenant/source.docx' } },
      ],
    });
    expect(projected?.revisions).toEqual([
      { id: 'master', kind: 'original', title: 'Resume', markdown: 'published', sourceRevisionId: null },
    ]);
    expect(projected).toMatchObject({ originalRevisionId: 'master', activeRevisionId: 'master', masterRevisionId: 'master', archivedAt: null, watched: false });
  });

  it('rejects non-public and empty families', () => {
    expect(projectPublicResumeFamily({
      privacy: 'private',
      revisions: [{ id: 'one', kind: 'original', title: 'Resume', markdown: 'private' }],
    })).toBeNull();
    expect(projectPublicResumeFamily({ privacy: 'public', revisions: [] })).toBeNull();
  });

  it('stops serving a family once it is archived', () => {
    // Archiving is how somebody takes a résumé down, so it has to reach the
    // public link. Projecting an archived family with `archivedAt` merely
    // stripped — which is what this asserted before — would have kept every
    // shared link live after the owner archived it.
    expect(projectPublicResumeFamily({
      privacy: 'public', archivedAt: '2026-01-01',
      revisions: [{ id: 'master', kind: 'derived', title: 'Resume', markdown: 'published' }],
    })).toBeNull();
  });
});
