/**
 * The export acts — a gradebook as CSV, a reference list as BibTeX — returned as a
 * DOWNLOAD the runner saves through `lib/download.ts`, never saved by the act itself.
 */

import { describe, expect, it } from 'vitest';
import { exportCitationAct, exportGradebookAct, exportReferencesAct } from './academicActs';
import type { CardActBoard, CardActOutcome } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function object(id: string, kind: string, data: Record<string, unknown> = {}): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: { kind: kind as CreationObjectKind, title: id, ...data } };
}

function board(objects: CanvasObject[]): CardActBoard {
  return { objects, create: (kind, position) => ({ id: `new-${kind}`, type: 'creation', position, data: { kind, title: '' } }) };
}

function sync(outcome: CardActOutcome | Promise<CardActOutcome>): CardActOutcome {
  if (outcome instanceof Promise) throw new Error('expected a synchronous act');
  return outcome;
}

describe('gradebook.export', () => {
  const cohort = object('c1', 'cohort', { title: 'Cohort A', roster: [{ ref: 'l1', name: 'Lovelace, Ada' }, { ref: 'l2', name: 'Grace' }] });
  const essay = object('a1', 'assignment', { title: 'Essay 1', weight: 100, maxMarks: 100 });
  const marked = object('s1', 'submission', { learnerRef: 'l1', assignmentRef: 'Essay 1', submittedAt: '2026-09-01T10:00:00Z', mark: 72 });
  const gradebook = object('g1', 'gradebook', {
    title: 'PHYS2041 marks', cohortRef: 'Cohort A', assignments: ['Essay 1'],
    gradeBands: [{ grade: 'Fail', minimum: 0, maximum: 49.99 }, { grade: 'Pass', minimum: 50, maximum: 100 }],
  });

  it('describes a CSV of the whole cohort, quoted so a comma in a name cannot shift a row', () => {
    const outcome = sync(exportGradebookAct.run({ object: gradebook, action: 'export', board: board([cohort, essay, marked, gradebook]), t }));
    expect(outcome.download?.mimeType).toBe('text/csv');
    expect(outcome.download?.filename).toMatch(/\.csv$/);
    expect(outcome.download?.text).toContain('"Lovelace, Ada"');
    expect(outcome.download?.text).toContain('"72"');
    expect(outcome.notice).toBe('noticeGradebookExported:{"count":2}');
    expect(outcome.patch).toBeUndefined();
  });

  it('refuses an empty gradebook rather than downloading a header row', () => {
    const lonely = object('g2', 'gradebook', { cohortRef: 'nothing' });
    const outcome = sync(exportGradebookAct.run({ object: lonely, action: 'export', board: board([lonely]), t }));
    expect(outcome.download).toBeUndefined();
    expect(outcome.notice).toBe('noticeGradebookEmpty');
  });
});

describe('bibliography.export and citation.export', () => {
  const bibliography = object('b1', 'bibliography', {
    title: 'Reading list',
    entries: [{ citationKey: 'rao2026', authors: 'Rao, Grace I.; Diaz, Marta', year: '2026', workTitle: 'Thermal transport in layered solids', doi: '10.1038/s41563-026-01887-2' }],
  });

  it('describes the list as BibTeX', () => {
    const outcome = sync(exportReferencesAct.run({ object: bibliography, action: 'export', board: board([bibliography]), t }));
    expect(outcome.download?.mimeType).toBe('application/x-bibtex');
    expect(outcome.download?.filename).toMatch(/\.bib$/);
    expect(outcome.download?.text).toContain('rao2026');
    expect(outcome.download?.text).toContain('Thermal transport in layered solids');
    expect(outcome.notice).toBe('noticeReferencesExported:{"count":1}');
  });

  it('exports one citation card on its own', () => {
    const citation = object('c1', 'citation', { title: 'Thermal transport in layered solids', citationKey: 'rao2026', authors: ['Rao, Grace I.'], year: '2026' });
    const outcome = sync(exportCitationAct.run({ object: citation, action: 'export', board: board([citation]), t }));
    expect(outcome.download?.text).toContain('rao2026');
  });

  it('says there is nothing to export instead of downloading an empty file', () => {
    const empty = object('b2', 'bibliography', { entries: [] });
    const outcome = sync(exportReferencesAct.run({ object: empty, action: 'export', board: board([empty]), t }));
    expect(outcome.download).toBeUndefined();
    expect(outcome.notice).toBe('noticeReferencesExportEmpty');
  });
});
