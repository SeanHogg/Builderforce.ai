import { describe, expect, it } from 'vitest';
import { JOURNAL_LIMIT, createCanvasJournal, describeGraphChange, journalGaps, summarizeTimings } from './canvasActionJournal';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createCanvasJournal', () => {
  it('records what happened, in order', () => {
    const journal = createCanvasJournal(clock().now);
    journal.record({ kind: 'user', label: 'file.import', detail: 'guide.htm' });
    journal.record({ kind: 'user', label: 'object.add', detail: 'workflow' });
    expect(journal.entries().map((entry) => entry.label)).toEqual(['file.import', 'object.add']);
    expect(journal.entries().map((entry) => entry.seq)).toEqual([1, 2]);
    expect(journal.entries().map((entry) => entry.durationMs)).toEqual([0, 0]);
  });

  it('marks an already-completed tool trace as instantaneous rather than pending', () => {
    const journal = createCanvasJournal(clock().now);
    journal.record({ kind: 'tool', label: 'builtin_web_fetch', ok: true });

    expect(summarizeTimings(journal.entries())[0]).toMatchObject({ pending: 0, p50Ms: 0, maxMs: 0 });
    expect(journalGaps(journal.entries(), { objectCount: 1, scope: 'canvas', scopedObjectCount: 1 })).toEqual([]);
  });

  it('stamps a duration when a timed action finishes', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const done = journal.begin('turn', 'brain.turn', 'Review the guide');
    time.advance(2_400);
    done({ ok: true });
    const [entry] = journal.entries();
    expect(entry.durationMs).toBe(2_400);
    expect(entry.ok).toBe(true);
  });

  it('shows an action that never finished rather than hiding it', () => {
    const journal = createCanvasJournal(clock().now);
    journal.begin('turn', 'brain.turn');
    expect(journal.entries()[0]!.durationMs).toBeUndefined();
  });

  it('ignores a second settle so one action cannot report two durations', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const done = journal.begin('io', 'session.save');
    time.advance(100);
    done({ ok: true });
    time.advance(5_000);
    done({ ok: false });
    expect(journal.entries()[0]!.durationMs).toBe(100);
    expect(journal.entries()[0]!.ok).toBe(true);
  });

  it('drops the OLDEST entries when it overflows', () => {
    const journal = createCanvasJournal(clock().now);
    for (let i = 0; i < JOURNAL_LIMIT + 10; i += 1) journal.record({ kind: 'user', label: `a${i}` });
    const entries = journal.entries();
    expect(entries).toHaveLength(JOURNAL_LIMIT);
    expect(entries[entries.length - 1]!.label).toBe(`a${JOURNAL_LIMIT + 9}`);
  });
});

describe('summarizeTimings', () => {
  it('rolls up by label, worst first, and counts what never finished', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const a = journal.begin('tool', 'canvas_add_object');
    time.advance(50); a();
    const b = journal.begin('turn', 'brain.turn');
    time.advance(9_000); b({ ok: false });
    journal.begin('turn', 'brain.turn');

    const [slowest, fastest] = summarizeTimings(journal.entries());
    expect(slowest.label).toBe('brain.turn');
    expect(slowest.count).toBe(2);
    expect(slowest.pending).toBe(1);
    expect(slowest.failed).toBe(1);
    expect(slowest.maxMs).toBe(9_000);
    expect(fastest.label).toBe('canvas_add_object');
  });
});

describe('journalGaps', () => {
  const whole = { objectCount: 4, scope: 'canvas', scopedObjectCount: 4 };

  it('names the scoped-turn condition behind the reported failure', () => {
    const gaps = journalGaps([], { objectCount: 4, scope: 'selection', scopedObjectCount: 1 });
    expect(gaps.join(' ')).toContain('ran against 1 of 4 objects');
    expect(gaps.join(' ')).toContain('answering about a subset');
  });

  it('says nothing about scope when the turn saw the whole board', () => {
    expect(journalGaps([], whole)).toEqual([]);
  });

  it('reports files that could not be read', () => {
    const journal = createCanvasJournal(clock().now);
    journal.record({ kind: 'user', label: 'file.import', detail: 'notes.htm → document' });
    journal.record({ kind: 'user', label: 'file.import', detail: 'archive.bin → attachment (unreadable)' });
    expect(journalGaps(journal.entries(), whole).join(' ')).toContain('1 of 2 imported file(s) could not be read');
  });

  it('reports an action that hung', () => {
    const journal = createCanvasJournal(clock().now);
    journal.begin('turn', 'brain.turn');
    expect(journalGaps(journal.entries(), whole).join(' ')).toContain('never completed');
  });

  it('reports a slow tool call', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const done = journal.begin('tool', 'builtin_web_fetch');
    time.advance(45_000);
    done({ ok: true });
    expect(journalGaps(journal.entries(), whole).join(' ')).toContain('over 30s');
  });

  it('does NOT flag a long turn that spent the time calling tools', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const turn = journal.begin('turn', 'brain.turn');
    const tool = journal.begin('tool', 'canvas_add_object');
    time.advance(2_000);
    tool({ ok: true });
    time.advance(41_000);
    turn({ ok: true });
    const gaps = journalGaps(journal.entries(), whole).join(' ');
    expect(gaps).not.toContain('over 30s');
    expect(gaps).not.toContain('without calling a single tool');
  });

  it('flags a long turn that called no tool at all', () => {
    const time = clock();
    const journal = createCanvasJournal(time.now);
    const done = journal.begin('turn', 'brain.turn');
    time.advance(45_000);
    done({ ok: true });
    expect(journalGaps(journal.entries(), whole).join(' ')).toContain('without calling a single tool');
  });
});

describe('describeGraphChange — what the person did to the board', () => {
  const node = (id: string, kind: string, title: string, extra: Record<string, unknown> = {}) =>
    ({ id, data: { kind, title, ...extra } });
  const graph = (nodes: ReturnType<typeof node>[], edgeCount = 0) =>
    ({ nodes, edges: Array.from({ length: edgeCount }, (_, i) => ({ id: `e${i}` })) });

  it('names the objects that were added', () => {
    const change = describeGraphChange(
      graph([node('a', 'chat', 'Brain')]),
      graph([node('a', 'chat', 'Brain'), node('b', 'workflow', 'Renewal Outreach')]),
    );
    expect(change).toEqual({ label: 'object.add', detail: 'workflow "Renewal Outreach"' });
  });

  it('names the objects that were deleted', () => {
    const change = describeGraphChange(
      graph([node('a', 'chat', 'Brain'), node('b', 'code', 'guide.htm')]),
      graph([node('a', 'chat', 'Brain')]),
    );
    expect(change).toEqual({ label: 'object.delete', detail: 'code "guide.htm"' });
  });

  it('reports connections separately from objects', () => {
    const before = graph([node('a', 'chat', 'Brain')], 0);
    expect(describeGraphChange(before, graph([node('a', 'chat', 'Brain')], 1))?.label).toBe('connection.add');
    expect(describeGraphChange(graph([node('a', 'chat', 'Brain')], 2), before)?.label).toBe('connection.delete');
  });

  it('names WHICH object was edited', () => {
    const change = describeGraphChange(
      graph([node('a', 'workflow', 'Renewal', { steps: [] })]),
      graph([node('a', 'workflow', 'Renewal', { steps: [{ title: 'Draft' }] })]),
    );
    expect(change).toEqual({ label: 'object.edit', detail: 'workflow "Renewal"' });
  });

  it('says nothing when nothing material changed', () => {
    const same = graph([node('a', 'chat', 'Brain')]);
    expect(describeGraphChange(same, graph([node('a', 'chat', 'Brain')]))).toBeNull();
  });

  it('summarizes a bulk change rather than listing all of it', () => {
    const before = graph([]);
    const after = graph(Array.from({ length: 7 }, (_, i) => node(`n${i}`, 'note', `Note ${i}`)));
    expect(describeGraphChange(before, after)!.detail).toContain('+3 more');
  });
});
