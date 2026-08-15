// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredJournal, writeStoredJournal } from './canvasJournalStore';
import { createCanvasJournal } from './canvasActionJournal';

const SESSION = 'local-abc';

describe('canvasJournalStore', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('round-trips a journal so a reload can still explain what happened', () => {
    const journal = createCanvasJournal();
    journal.record({ kind: 'user', label: 'file.import', detail: 'guide.htm', ok: true });
    const done = journal.begin('turn', 'brain.turn');
    done({ ok: false, detail: 'timeout' });

    writeStoredJournal(SESSION, journal.entries());
    const restored = readStoredJournal(SESSION);
    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ label: 'file.import', detail: 'guide.htm', ok: true });
    expect(restored[1]).toMatchObject({ label: 'brain.turn', ok: false });
  });

  it('is scoped per session, so two boards in one tab do not share a history', () => {
    writeStoredJournal(SESSION, [{ seq: 1, at: '2026-08-13T10:00:00.000Z', kind: 'user', label: 'a' }]);
    expect(readStoredJournal('local-other')).toEqual([]);
  });

  it('drops anything that is not a recorded action', () => {
    window.sessionStorage.setItem(`builderforce:canvas-journal:${SESSION}`, JSON.stringify([
      { seq: 1, at: '2026-08-13T10:00:00.000Z', kind: 'user', label: 'ok' },
      { seq: 2, at: '2026-08-13T10:00:01.000Z', kind: 'not-a-kind', label: 'nope' },
      { label: 'no seq' },
      'garbage',
    ]));
    expect(readStoredJournal(SESSION).map((action) => action.label)).toEqual(['ok']);
  });

  it('survives unparseable storage rather than breaking the board', () => {
    window.sessionStorage.setItem(`builderforce:canvas-journal:${SESSION}`, '{not json');
    expect(readStoredJournal(SESSION)).toEqual([]);
  });

  it('restores into a journal and keeps recording past the highest sequence', () => {
    const journal = createCanvasJournal();
    journal.restore([{ seq: 7, at: '2026-08-13T10:00:00.000Z', kind: 'user', label: 'before reload' }]);
    journal.record({ kind: 'user', label: 'after reload' });
    expect(journal.entries().map((action) => action.seq)).toEqual([7, 8]);
  });

  it('clears the key when the journal is empty rather than storing an empty array', () => {
    writeStoredJournal(SESSION, [{ seq: 1, at: '2026-08-13T10:00:00.000Z', kind: 'user', label: 'a' }]);
    writeStoredJournal(SESSION, []);
    expect(window.sessionStorage.getItem(`builderforce:canvas-journal:${SESSION}`)).toBeNull();
  });
});
