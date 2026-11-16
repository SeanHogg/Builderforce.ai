/**
 * The files already in the model's context this run — the turn-tail section that tells a model which files are still
 * above it, unchanged, so a steer does not send it back to re-read them (chat #133542).
 */
import { describe, expect, it } from 'vitest';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { runBrief, withRunBrief } from './brainTurnTail';
import { READ_LEDGER_HEADER, READ_LEDGER_MAX_FILES, readLedgerSection, type ReadLedgerTraceEvent } from './readLedgerSection';

const read = (path: string, content: string, extra: Record<string, unknown> = {}, args: Record<string, unknown> = {}): ReadLedgerTraceEvent => ({
  category: 'tool',
  label: 'read_file',
  args: { path, ...args },
  result: { ok: true, path, content, ...extra },
});
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
const edit = (path: string): ReadLedgerTraceEvent => ({ category: 'tool', label: 'edit_file', args: { path, old_string: 'a', new_string: 'b' }, result: { ok: true } });
const shell = (command: string): ReadLedgerTraceEvent => ({ category: 'tool', label: 'run_command', args: { command }, result: { ok: true, stdout: '' } });
const steer = (text: string): ReadLedgerTraceEvent => ({ category: 'message', label: 'steer.applied', args: { step: 3, messages: 1 }, result: text });

/** The slice of a run `runBrief` reads: its trace and its knowledge record (held below the brief's threshold here). */
function runOf(trace: ReadLedgerTraceEvent[]): BrainRunContext {
  return {
    c: { trace, runTraceFrom: 0 },
    knowledge: { brief: () => null },
    allTools: [],
  } as unknown as BrainRunContext;
}

describe('readLedgerSection', () => {
  it('is empty before the run has read a file', () => {
    expect(readLedgerSection([])).toBe('');
    expect(readLedgerSection([shell('npm test')])).toBe('');
  });

  it('lists the files read, newest first, with the lines served and unchanged', () => {
    const section = readLedgerSection([
      read('src/a.ts', lines(120), { totalLines: 530, offset: 1, truncated: true }),
      read('src/b.ts', lines(10), { totalLines: 10, offset: 1, truncated: false }),
      read('src/a.ts', lines(50), { totalLines: 530, offset: 200, truncated: true }, { offset: 200, limit: 50 }),
    ]);
    expect(section.split('\n')).toEqual([
      READ_LEDGER_HEADER,
      '- src/a.ts · lines 1–120, 200–249 · unchanged',
      '- src/b.ts · lines 1–10 · unchanged',
    ]);
  });

  it('normalizes the spellings of one path and merges its overlapping windows', () => {
    const section = readLedgerSection([
      read('./src/a.ts', lines(100), { totalLines: 400, offset: 1, truncated: true }),
      read('src\\a.ts', lines(100), { totalLines: 400, offset: 50, truncated: true }, { offset: 50 }),
    ]);
    expect(section).toContain('- src/a.ts · lines 1–149 · unchanged');
    expect(section.split('\n')).toHaveLength(2);
  });

  it('marks a window the host trimmed by its first line only', () => {
    const section = readLedgerSection([{ ...read('src/big.ts', lines(800), { totalLines: 800, offset: 1 }), truncated: true }]);
    expect(section).toContain('- src/big.ts · from line 1 (window trimmed) · unchanged');
  });

  it('flips a file the run edited to changed since (by this run), and only that file', () => {
    const section = readLedgerSection([read('src/a.ts', lines(5), { totalLines: 5 }), read('src/b.ts', lines(5), { totalLines: 5 }), edit('src/a.ts')]);
    expect(section).toContain('- src/a.ts · lines 1–5 · changed since (by this run)');
    expect(section).toContain('- src/b.ts · lines 1–5 · unchanged');
  });

  it('a read after the edit is the file as it is now: unchanged, with only the new window', () => {
    const section = readLedgerSection([
      read('src/a.ts', lines(5), { totalLines: 5 }),
      edit('src/a.ts'),
      read('src/a.ts', lines(3), { totalLines: 6, offset: 2, truncated: true }, { offset: 2, limit: 3 }),
    ]);
    expect(section).toContain('- src/a.ts · lines 2–4 · unchanged');
  });

  it('a run_command flips every file read before it to may have changed', () => {
    const section = readLedgerSection([read('src/a.ts', lines(5), { totalLines: 5 }), read('src/b.ts', lines(5), { totalLines: 5 }), shell('npm run build'), read('src/c.ts', lines(2), { totalLines: 2 })]);
    expect(section).toContain('- src/a.ts · lines 1–5 · may have changed (a shell command ran since)');
    expect(section).toContain('- src/b.ts · lines 1–5 · may have changed (a shell command ran since)');
    expect(section).toContain('- src/c.ts · lines 1–2 · unchanged');
  });

  it('leaves out a file whose newest read failed, and the read guard\'s own stubs add nothing', () => {
    const section = readLedgerSection([
      read('src/a.ts', lines(5), { totalLines: 5 }),
      { category: 'tool', label: 'read_file', args: { path: 'src/a.ts' }, result: { ok: false, error: 'ENOENT' }, isError: true },
      { category: 'tool', label: 'read_file', args: { path: 'src/stub.ts' }, result: { covered: true, note: 'already returned' } },
      read('src/b.ts', lines(5), { totalLines: 5 }),
    ]);
    expect(section).not.toContain('src/a.ts');
    expect(section).not.toContain('src/stub.ts');
    expect(section).toContain('- src/b.ts · lines 1–5 · unchanged');
  });

  it('records each file of a paths[] read', () => {
    const section = readLedgerSection([
      {
        category: 'tool',
        label: 'read_file',
        args: { paths: ['src/a.ts', 'src/missing.ts', 'src/b.ts'] },
        result: { ok: true, files: [{ ok: true, path: 'src/a.ts', content: lines(3), totalLines: 3 }, { ok: false, path: 'src/missing.ts', error: 'ENOENT' }, { ok: true, path: 'src/b.ts', content: lines(4), totalLines: 4 }] },
      },
    ]);
    expect(section).toContain('- src/a.ts · lines 1–3 · unchanged');
    expect(section).toContain('- src/b.ts · lines 1–4 · unchanged');
    expect(section).not.toContain('src/missing.ts');
  });

  it(`holds its cap of ${READ_LEDGER_MAX_FILES} files, keeping the newest`, () => {
    const trace = Array.from({ length: READ_LEDGER_MAX_FILES + 5 }, (_, i) => read(`src/f${i}.ts`, lines(1), { totalLines: 1 }));
    const rows = readLedgerSection(trace).split('\n').slice(1);
    expect(rows).toHaveLength(READ_LEDGER_MAX_FILES);
    expect(rows[0]).toContain(`src/f${READ_LEDGER_MAX_FILES + 4}.ts`);
    expect(rows.some((r) => r.includes('src/f0.ts'))).toBe(false);
  });
});

describe('runBrief carries the read ledger', () => {
  it('renders on the first tool turn after a steer, without waiting for the brief threshold', () => {
    const run = runOf([read('src/a.ts', lines(5), { totalLines: 5 }), steer('also handle the empty case')]);
    expect(runBrief(run, 3)).toContain(READ_LEDGER_HEADER);
    expect(runBrief(run, 3)).toContain('- src/a.ts · lines 1–5 · unchanged');
  });

  it('adds nothing to a turn that offers no tools', () => {
    const run = runOf([read('src/a.ts', lines(5), { totalLines: 5 })]);
    expect(runBrief(run, 0)).toBe('');
    expect(withRunBrief(run, { tools: [] })).toEqual({ tools: [] });
  });

  it('regression: chat #133542 — after reads of shipGates.ts and gates.ts and a mid-run review message, the next turn lists both as unchanged', () => {
    const run = runOf([
      read('brain-embedded/src/runStore/shipGates.ts', lines(530), { totalLines: 530, offset: 1 }),
      read('brain-embedded/src/runStore/gates.ts', lines(200), { totalLines: 200, offset: 1 }),
      steer('Review: the gate still lets an unverified push through — fix it'),
    ]);
    const menu = withRunBrief(run, { tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: {} } }] as never });
    const tail = (menu && menu.tail?.[0]) ?? '';
    expect(tail).toContain(READ_LEDGER_HEADER);
    expect(tail).toContain('- brain-embedded/src/runStore/gates.ts · lines 1–200 · unchanged');
    expect(tail).toContain('- brain-embedded/src/runStore/shipGates.ts · lines 1–530 · unchanged');
    expect(tail.indexOf('gates.ts · lines 1–200')).toBeLessThan(tail.indexOf('shipGates.ts'));
  });
});
