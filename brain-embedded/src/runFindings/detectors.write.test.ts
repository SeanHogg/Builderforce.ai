/**
 * Run-findings detectors, writing side: one fires / does-not-fire pair per kind, plus the report's ordering and
 * file ledger.
 */
import { describe, expect, it } from 'vitest';
import { detectRunFindings } from './detectRunFindings';
import { TraceBuilder, type BuiltCall } from './fixtures/traceBuilder';
import type { RunFindingKind } from './types';

const write = (path = 'src/a.ts', content = 'export const a = { b: [1] };\n'): BuiltCall => ({ name: 'write_file', args: { path, content } });
const edit = (path: string, old_string: string, new_string: string): BuiltCall => ({ name: 'edit_file', args: { path, old_string, new_string } });
const typecheck: BuiltCall = { name: 'run_command', args: { command: 'pnpm --filter @x/y run typecheck' }, result: { ok: true, exitCode: 0 } };

const report = (b: TraceBuilder) => detectRunFindings(b.events, b.messages());
const of = (b: TraceBuilder, kind: RunFindingKind) => report(b).findings.filter((f) => f.kind === kind);

function singleWrites(n: number, prompt = 100_000): TraceBuilder {
  const b = new TraceBuilder();
  for (let i = 0; i < n; i++) b.turn({ role: 'code', prompt, calls: [write(`src/f${i}.ts`)] });
  return b;
}

describe('serial_single_writes', () => {
  it('fires on 4 turns that each made exactly one write', () => {
    expect(of(singleWrites(4), 'serial_single_writes')[0]).toMatchObject({ severity: 'warn', params: { turns: 4, promptTokens: 400_000 } });
  });
  it('stays quiet when writes were batched', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [write('a.ts'), write('b.ts'), write('c.ts'), write('d.ts')] });
    expect(of(b, 'serial_single_writes')).toEqual([]);
  });
});

describe('prompt_bloat', () => {
  it('fires at a 50:1 ratio over 500 k prompt tokens', () => {
    const b = singleWrites(6).turn({ role: 'code', prompt: 100_000, completion: 100 });
    expect(of(b, 'prompt_bloat')[0]).toMatchObject({ severity: 'warn', params: { ratio: 538, promptTokens: 700_000, perWrite: 116_667 } });
  });
  it('stays quiet on a small run', () => {
    expect(of(singleWrites(2), 'prompt_bloat')).toEqual([]);
  });
});

describe('unverified_writes', () => {
  it('names every written file no check followed', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [write('src/a.ts'), write('src/b.ts')] }).turn({ role: 'code', calls: [typecheck] })
      .turn({ role: 'code', calls: [write('src/b.ts')] });
    const r = report(b);
    expect(r.findings.find((f) => f.kind === 'unverified_writes')).toMatchObject({ severity: 'error', params: { files: 1, writes: 2 } });
    expect(r.files).toEqual([{ path: 'src/a.ts', writes: 1, checked: true }, { path: 'src/b.ts', writes: 2, checked: false }]);
  });
  it('stays quiet when a diagnostics tool checked after the writes', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [write(), { name: 'get_diagnostics', args: { path: 'src/a.ts' }, result: { ok: true, errors: [] } }] });
    expect(of(b, 'unverified_writes')).toEqual([]);
  });
  it('does not count a failed check or a non-check command', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [write(), { name: 'run_command', args: { command: 'git status' } }, { ...typecheck, result: { ok: false, error: 'exit 2' } }] });
    expect(of(b, 'unverified_writes')).toHaveLength(1);
  });
});

describe('bracket_break', () => {
  it('fires on an edit whose new text changes bracket balance', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [edit('src/labels.ts', '  ...A,', '  ...A,\n  ...B,\n};')] });
    expect(of(b, 'bracket_break')[0]).toMatchObject({ severity: 'error', params: { path: 'src/labels.ts', delta: 'curly -1' } });
  });
  it('checks every entry of a batched edit', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [{ name: 'edit_file', args: { edits: [
      { path: 'src/a.ts', old_string: 'f(x)', new_string: 'f(g(x)' },
      { path: 'src/b.ts', old_string: 'x', new_string: 'y' },
    ] } }] });
    expect(of(b, 'bracket_break').map((f) => f.params)).toEqual([{ path: 'src/a.ts', delta: 'paren +1' }]);
  });
  it('gives every finding of one batched call a unique id', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [{ name: 'edit_file', args: { edits: [
      { path: 'src/a.ts', old_string: 'f(x)', new_string: 'f(g(x)' },
      { path: 'src/b.ts', old_string: 'f(x)', new_string: 'f(g(x)' },
      { path: 'src/b.ts', old_string: 'h(x)', new_string: 'h(g(x)' },
    ] } }] });
    const ids = of(b, 'bracket_break').map((f) => f.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
  it('never flags a whole-file write_file', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [write('src/a.tsx', "export const A = () => <p>Don't (stop</p>;\n{")] });
    expect(of(b, 'bracket_break')).toEqual([]);
  });
  it('stays quiet on balanced edits, brackets in strings, and failed edits', () => {
    const b = new TraceBuilder().turn({ role: 'code', calls: [
      edit('src/a.ts', 'a', "const s = '{';"),
      write('src/c.ts'),
      { ...edit('src/d.ts', 'a', '{'), result: { ok: false, error: 'old_string not found' } },
    ] });
    expect(of(b, 'bracket_break')).toEqual([]);
  });
});

describe('edit_churn', () => {
  it('fires on a path written 4 times', () => {
    const b = new TraceBuilder();
    for (let i = 0; i < 4; i++) b.turn({ role: 'code', calls: [edit('src/a.ts', `v${i}`, `v${i + 1}`)] });
    expect(of(b, 'edit_churn')[0]).toMatchObject({ severity: 'warn', params: { path: 'src/a.ts', writes: 4 } });
  });
  it('stays quiet at 3', () => {
    const b = new TraceBuilder();
    for (let i = 0; i < 3; i++) b.turn({ role: 'code', calls: [edit('src/a.ts', `v${i}`, `v${i + 1}`)] });
    expect(of(b, 'edit_churn')).toEqual([]);
  });
});

describe('repeated_narration', () => {
  it('fires on consecutive pre-call texts saying the same thing', () => {
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: "I've written a.ts. Continuing with the wiring." })
      .turn({ role: 'code', calls: [write('b.ts')], text: "I've written b.ts. Continuing with the wiring." });
    expect(of(b, 'repeated_narration')[0]).toMatchObject({ severity: 'info', params: { turns: 2 } });
  });
  it('stays quiet on different texts', () => {
    const b = new TraceBuilder()
      .turn({ role: 'code', calls: [write('a.ts')], text: 'Writing the style model first.' })
      .turn({ role: 'code', calls: [write('b.ts')], text: 'Now the camera component, with its SVG layer.' });
    expect(of(b, 'repeated_narration')).toEqual([]);
  });
});

describe('stopped_unverified', () => {
  it('fires when the run ended on a Stop with unchecked writes', () => {
    expect(of(singleWrites(1).stop(), 'stopped_unverified')[0]).toMatchObject({ severity: 'error', params: { files: 1 } });
  });
  it('stays quiet when the writes were checked, or a turn completed after the Stop', () => {
    expect(of(singleWrites(1).turn({ role: 'code', calls: [typecheck] }).stop(), 'stopped_unverified')).toEqual([]);
    expect(of(singleWrites(1).stop().turn({ role: 'code', text: 'Done.' }), 'stopped_unverified')).toEqual([]);
  });
});

describe('the report', () => {
  // Both errors' evidence starts at the first write, so kind breaks the tie.
  it('orders findings by severity, then first evidence step, then kind', () => {
    const r = report(singleWrites(4).turn({ role: 'code', durationMs: 70_000 }).stop());
    expect(r.findings.map((f) => f.severity)).toEqual([...r.findings.map((f) => f.severity)].sort((a, b) =>
      ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]));
    expect(r.findings.map((f) => f.kind)).toEqual(['stopped_unverified', 'unverified_writes', 'serial_single_writes', 'slow_turns']);
    expect(r.summary).toMatchObject({ turns: 5, counts: { error: 2, warn: 2, info: 0 }, title: 'Change the code.' });
  });
});
