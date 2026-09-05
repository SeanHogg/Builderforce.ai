import { describe, it, expect } from 'vitest';
import { ReadCoverage, revisitAdvisory, withAdvisory, REVISIT_NUDGE_AT, REVISIT_HARD_AT } from './readCoverage';

const CSS = 'frontend/src/components/home/LandingCanvasHero.module.css';

describe('ReadCoverage', () => {
  it('counts overlapping windows over ONE file as visits to one target', () => {
    const cov = new ReadCoverage();
    let last = cov.record('read_file', { path: CSS, offset: 1 })!;
    for (const offset of [140, 141, 208, 240, 340, 440]) {
      last = cov.record('read_file', { path: CSS, offset })!;
    }
    // The exact-repeat guard sees seven DIFFERENT calls here and stays silent; this
    // is the whole reason the target tally exists.
    expect(last.count).toBe(7);
    expect(cov.repeated()).toEqual([{ target: `read_file:${CSS}`, count: 7 }]);
  });

  it('keeps different files apart', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: 'a.css' });
    const b = cov.record('read_file', { path: 'b.css' })!;
    expect(b.count).toBe(1);
    expect(cov.repeated()).toEqual([]);
  });

  it('keeps different TOOLS on the same file apart', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    expect(cov.record('search_code', { path: CSS })!.count).toBe(1);
  });

  it('ignores a call with no discernible target', () => {
    expect(new ReadCoverage().record('list_files', { recursive: true })).toBeNull();
  });

  it('remembers the distinct argument sets, without duplicating them', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS, offset: 1 });
    cov.record('read_file', { path: CSS, offset: 1 });
    const v = cov.record('read_file', { path: CSS, offset: 2 })!;
    expect(v.count).toBe(3);
    expect(v.priorArgs).toHaveLength(2);
  });

  it('forgets after a mutation — a read AFTER a change is new information', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.reset();
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
  });
});

describe('revisitAdvisory', () => {
  const visit = (count: number) => ({ count, priorArgs: ['{"path":"a.css","offset":1}', '{"path":"a.css","offset":2}'] });

  it('stays silent for ordinary navigation', () => {
    for (let n = 1; n < REVISIT_NUDGE_AT; n += 1) {
      expect(revisitAdvisory('read_file', CSS, visit(n))).toBeNull();
    }
  });

  it('nudges at the threshold, naming the target and what was already tried', () => {
    const note = revisitAdvisory('read_file', CSS, visit(REVISIT_NUDGE_AT))!;
    expect(note).toContain(CSS);
    expect(note).toContain('3 times');
    expect(note).toContain('offset');
    // It has to offer the way OUT, not just report the problem.
    expect(note).toMatch(/read the file whole|search for the specific symbol/i);
  });

  it('escalates to an instruction once the nudge has demonstrably failed', () => {
    const note = revisitAdvisory('read_file', CSS, visit(REVISIT_HARD_AT))!;
    expect(note).toContain('STOP RE-READING');
    expect(note).toMatch(/make the edit, or state plainly what is blocking you/i);
    expect(note).toContain('exhausts its tool budget');
  });
});

describe('withAdvisory', () => {
  it('adds a note without disturbing the result shape', () => {
    const out = withAdvisory({ ok: true, content: 'x' }, 'careful') as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.content).toBe('x');
    expect(out.note).toBe('careful');
  });

  it('appends to an existing note rather than overwriting the tool\'s own', () => {
    const out = withAdvisory({ ok: true, note: 'truncated' }, 'careful') as Record<string, unknown>;
    expect(out.note).toBe('truncated\n\ncareful');
  });

  it('wraps a non-object result so the original survives', () => {
    const out = withAdvisory('plain text', 'careful') as Record<string, unknown>;
    expect(out.result).toBe('plain text');
    expect(out.note).toBe('careful');
  });

  it('wraps an array rather than spreading it into an object', () => {
    const out = withAdvisory([1, 2], 'careful') as Record<string, unknown>;
    expect(out.result).toEqual([1, 2]);
  });
});
