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

  it('forgets the MUTATED target — a read after a change is new information', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
  });

  /**
   * The reason this guard was almost inert. Clearing the WHOLE tally on every non-read
   * call meant one edit, ticket write or failed dispatch erased the history of every
   * other file in the run — and in a run that interleaves reads with platform writes
   * the counter never reached the nudge. Measured: one CSS file read 14 times and its
   * component 13, across 78 calls, with the advisory firing on neither.
   */
  it('keeps the tally for every target the mutation did NOT touch', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: 'other.tsx' });
    cov.record('read_file', { path: 'other.tsx' });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.record('read_file', { path: 'other.tsx' })!.count).toBe(3);
  });

  it('invalidates a target across every tool that reads it', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('write_file', { path: CSS });
    expect(cov.record('search_code', { path: CSS })!.count).toBe(1);
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
  });

  it('invalidates NOTHING for a write that touched no file', () => {
    // A ticket write, a sign-off, a refused dispatch: none of them changed anything on
    // disk that this tally describes, so none of them earns the model a clean slate.
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('builtin_tickets_from_delta', { chatId: 99, summary: 'x' });
    expect(cov.record('read_file', { path: CSS })!.count).toBe(3);
  });

  it('invalidates EVERYTHING after a shell command — its blast radius is unknown', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: 'other.tsx' });
    cov.invalidate('run_command', { command: 'npx prettier --write .' });
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
    expect(cov.record('read_file', { path: 'other.tsx' })!.count).toBe(1);
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
