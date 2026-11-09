/**
 * PRD 45 §4.7 B5 — the host-derived progress line (chat #216 regression framing).
 *
 * One deterministic line per turn, a PURE function of the run's own trace: files
 * changed so far, how many of them have a check/diagnostic state, and what the push
 * gate still needs (`3 files changed · 2 checked · push needs: test for inbound.ts`).
 * It is host-derived, so it works with zero model cooperation — the trace the loop
 * already records is the only input, no new tool, `update_task_state` stays off.
 */
import { describe, expect, it } from 'vitest';
import { computeProgressLine, type ProgressTraceEvent } from './progressLine';

const edit = (path: string): ProgressTraceEvent => ({ category: 'tool', label: 'edit_file', args: { path, old_string: 'a', new_string: 'b' } });
const write = (path: string): ProgressTraceEvent => ({ category: 'tool', label: 'write_file', args: { path, content: 'x' } });

describe('computeProgressLine (PRD 45 §4.7 B5)', () => {
  it('regression (chat #216): 3 changed files with 2 checked yields the deterministic line', () => {
    const trace: ProgressTraceEvent[] = [
      { category: 'tool', label: 'edit_file', args: { path: 'src/inbound.ts', old_string: 'a', new_string: 'b' } },
      { category: 'tool', label: 'edit_file', args: { path: 'src/outbound.ts', old_string: 'a', new_string: 'b' } },
      { category: 'tool', label: 'write_file', args: { path: 'src/util.ts', content: 'x' } },
      // inbound.ts checked: a typecheck whose output names it.
      { category: 'tool', label: 'run_command', args: { command: 'npx tsc --noEmit -p brain-embedded' }, result: 'src/inbound.ts(7,5): error TS2304' },
      // outbound.ts checked: a targeted test run that names it.
      { category: 'tool', label: 'run_command', args: { command: 'npx vitest run outbound' }, result: '1 passed' },
      // util.ts: a NEW source file with no test → the push gate still needs a test for it.
    // (The tree-wide tsc covered every file's typecheck, so no "not typechecked" need.)
    ];
    expect(computeProgressLine(trace)).toBe('3 files changed · 2 checked · push needs: test for util.ts');
  });

  it('an empty trace yields no line', () => {
    expect(computeProgressLine([])).toBe('');
  });

  it('a trace of only reads yields no line (nothing changed)', () => {
    expect(computeProgressLine([{ category: 'tool', label: 'read_file', args: { path: 'a.ts' } }])).toBe('');
  });

  it('matches the PRD example when only the new source file lacks a test', () => {
    const trace: ProgressTraceEvent[] = [
      write('src/inbound.ts'),
      edit('src/outbound.ts'),
      edit('src/logger.ts'),
      { category: 'tool', label: 'run_command', args: { command: 'npx tsc --noEmit' }, result: 'src/inbound.ts(1,1): error TS2307' },
      { category: 'tool', label: 'run_command', args: { command: 'npx vitest run outbound' }, result: '1 passed' },
    ];
    expect(computeProgressLine(trace)).toBe('3 files changed · 2 checked · push needs: test for inbound.ts');
  });

  it('counts a check that ran BEFORE the write as stale (it spoke for older bytes)', () => {
    const trace: ProgressTraceEvent[] = [
      { category: 'tool', label: 'run_command', args: { command: 'npx vitest run a' }, result: '1 passed' },
      write('src/a.ts'),
    ];
    expect(computeProgressLine(trace)).toBe('1 files changed · 0 checked · push needs: test for a.ts; src/a.ts not typechecked');
  });

  it('a deleted file is settled and no longer a pending change', () => {
    const trace: ProgressTraceEvent[] = [write('src/a.ts'), { category: 'tool', label: 'delete_file', args: { path: 'src/a.ts' } }];
    expect(computeProgressLine(trace)).toBe('');
  });

  it('a failed write is not a change', () => {
    const trace: ProgressTraceEvent[] = [{ category: 'tool', label: 'write_file', args: { path: 'src/a.ts', content: 'x' }, isError: true }];
    expect(computeProgressLine(trace)).toBe('');
  });
});
