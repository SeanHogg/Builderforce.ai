import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_OUTPUT_CHARS,
  HARD_MAX_TOOL_RESULT_CHARS,
  READ_FILE_RESULT_CHARS,
  cutHead,
  cutHeadTail,
  detectRunner,
  fitToolText,
  keepTail,
  modelToolResultPolicy,
  projectJson,
  shapeToolResult,
  summarizeShellOutput,
  toolOutputCap,
  windowReadFile,
  windowToolResultCap,
} from './index.js';

const passing = (n: number) => Array.from({ length: n }, (_, i) => ` ✓ src/mod${i}.test.ts > does thing ${i} 3ms`).join('\n');

describe('caps', () => {
  it('reads the per-tool table with a generic default', () => {
    expect(toolOutputCap('read_file')).toBe(16_000);
    expect(toolOutputCap('run_command')).toBe(20_000);
    expect(toolOutputCap('tasks.list')).toBe(DEFAULT_TOOL_OUTPUT_CHARS);
    expect(toolOutputCap('x', { x: 10 })).toBe(10);
  });
  it('window cap is 30% of the window in chars, never above the hard cap', () => {
    expect(windowToolResultCap(100_000)).toBe(120_000);
    expect(windowToolResultCap(2_000_000)).toBe(HARD_MAX_TOOL_RESULT_CHARS);
  });
});

describe('text cuts', () => {
  it('keepTail keeps the end', () => {
    expect(keepTail('abcdef', 3)).toBe('def');
    expect(keepTail('ab', 3)).toBe('ab');
  });
  it('cutHead snaps to a line and appends the suffix', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const out = cutHead(text, 1_000, { suffix: '\n[cut]' });
    expect(out.endsWith('\n[cut]')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(out.slice(0, -'\n[cut]'.length).split('\n').every((l) => l.startsWith('line '))).toBe(true);
  });
  it('cutHead honours minKeep and the empty notice', () => {
    expect(cutHead('x'.repeat(5_000), 10, { minKeep: 2_000, suffix: '!' }).length).toBe(2_001);
    expect(cutHead('x'.repeat(50), 3, { suffix: '\n[n]', emptyNotice: '[n]' })).toBe('[n]');
  });
  it('cutHeadTail keeps the start AND the end with an elision marker', () => {
    const text = Array.from({ length: 2_000 }, (_, i) => `row ${i}`).join('\n');
    const out = cutHeadTail(text, 2_000);
    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out.startsWith('row 0\n')).toBe(true);
    expect(out.endsWith('row 1999')).toBe(true);
    expect(out).toMatch(/chars \([\d,]+ lines\) elided/);
  });
});

describe('summarizeShellOutput', () => {
  it('recognises the common runners', () => {
    expect(detectRunner(' Test Files  1 failed | 3 passed (4)')).toBe('vitest');
    expect(detectRunner('Test Suites: 1 failed, 2 passed')).toBe('jest');
    expect(detectRunner('==== test session starts ====')).toBe('pytest');
    expect(detectRunner('test result: FAILED. 3 passed; 1 failed')).toBe('cargo');
    expect(detectRunner("src/a.ts(3,5): error TS2322: Type 'x' is not assignable")).toBe('tsc');
    expect(detectRunner('--- FAIL: TestThing (0.00s)')).toBe('go');
    expect(detectRunner('hello world')).toBe('unknown');
  });

  it('keeps failing tests, errors, assertion diffs and the tail; drops passing noise', () => {
    const log = [
      ' RUN  v4.0.3 /repo',
      passing(800),
      ' × src/thing.test.ts > adds numbers 4ms',
      'AssertionError: expected 3 to be 4',
      '- Expected',
      '+ Received',
      '- 4',
      '+ 3',
      passing(800),
      ' Test Files  1 failed | 1599 passed (1600)',
      '      Tests  1 failed | 1599 passed (1600)',
    ].join('\n');
    const s = summarizeShellOutput(log, { maxChars: 6_000 });
    expect(s.text.length).toBeLessThanOrEqual(6_000);
    expect(s.runner).toBe('vitest');
    expect(s.failingTests).toContain('src/thing.test.ts > adds numbers');
    expect(s.text).toContain('AssertionError: expected 3 to be 4');
    expect(s.text).toContain('+ 3');
    expect(s.text).toContain('Tests  1 failed');
    expect(s.droppedNoise).toBeGreaterThan(700);
  });

  it('handles pytest, cargo and go failure names', () => {
    const noise = Array.from({ length: 3_000 }, (_, i) => `noise line ${i}`).join('\n');
    const log = `${noise}\nFAILED tests/test_a.py::test_one - assert 1 == 2\ntest tests::adds ... FAILED\n--- FAIL: TestThing (0.00s)\n${noise}`;
    const s = summarizeShellOutput(log, { maxChars: 5_000 });
    expect(s.failingTests).toEqual(expect.arrayContaining(['tests/test_a.py::test_one', 'tests::adds', 'TestThing']));
    expect(s.text.length).toBeLessThanOrEqual(5_000);
  });

  it('returns output within budget untouched', () => {
    expect(summarizeShellOutput('ok', { maxChars: 100 }).text).toBe('ok');
  });
});

describe('projectJson', () => {
  it('keeps every top-level key and counts the rows it cut', () => {
    const value = { total: 352, rows: Array.from({ length: 352 }, (_, i) => ({ id: i, title: `task ${i}`, body: 'b'.repeat(500) })), meta: { page: 1 } };
    const p = projectJson(value, 3_000);
    expect(p.fits).toBe(true);
    const out = p.value as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['total', 'rows', 'meta']);
    expect(JSON.stringify(out.rows)).toContain('more of 352 items');
  });
});

describe('windowReadFile', () => {
  it('pages at a line boundary and rewrites the continuation offset', () => {
    const content = Array.from({ length: 2_000 }, (_, i) => `const line${i} = ${i};`).join('\n');
    const { value, truncated } = windowReadFile({ ok: true, path: 'a.ts', content, offset: 1, totalLines: 2_000 });
    expect(truncated).toBe(true);
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    const kept = String(value.content).split('\n').length;
    expect(String(value.note)).toContain(`offset ${kept + 1}`);
  });
  it('attaches the advisory through the surface convention', () => {
    const { value } = windowReadFile({ ok: true, content: 'x' }, { advisory: 'seen', attachAdvisory: (r, a) => ({ ...(r as object), note: a }) });
    expect(value.note).toBe('seen');
  });
});

describe('shapeToolResult', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, title: `t${i}` }));

  it('passes small results through', () => {
    expect(shapeToolResult('x', { a: 1 })).toEqual({ content: '{"a":1}', bytes: 7, truncated: false });
  });

  it('lever off: legacy head slice with an item-count marker', () => {
    const r = shapeToolResult('tasks.list', rows);
    expect(r.truncated).toBe(true);
    expect(r.content).toContain('The full result had 400 items');
    expect(r.content.startsWith(JSON.stringify(rows).slice(0, 100))).toBe(true);
  });

  it('lever off: a shell tool keeps the generic cap', () => {
    const r = shapeToolResult('run_command', { ok: false, output: 'y'.repeat(10_000) });
    expect(r.content.length).toBeLessThan(DEFAULT_TOOL_OUTPUT_CHARS + 400);
  });

  it('lever on: projects large JSON instead of slicing it', () => {
    const r = shapeToolResult('tasks.list', rows, { summarize: true });
    expect(r.truncated).toBe(true);
    expect(r.content).toContain('more of 400 items');
    expect(r.content).toContain('projected to fit');
  });

  it('lever on: summarizes the log field of a shell result', () => {
    const output = `${passing(2_000)}\n × src/a.test.ts > breaks\nError: boom\n Test Files  1 failed (1)`;
    const r = shapeToolResult('run_command', { ok: false, exitCode: 1, output }, { summarize: true });
    expect(r.content.length).toBeLessThanOrEqual(20_000);
    const parsed = JSON.parse(r.content) as { exitCode: number; output: string };
    expect(parsed.exitCode).toBe(1);
    expect(parsed.output).toContain('Error: boom');
    expect(parsed.output).toContain('src/a.test.ts > breaks');
  });

  it('the advisory survives every cut', () => {
    const attachAdvisory = (r: unknown, a: string) => ({ result: r, note: a });
    expect(shapeToolResult('tasks.list', rows, { advisory: 'GUARD', attachAdvisory }).content).toContain('GUARD');
    expect(shapeToolResult('tasks.list', rows, { advisory: 'GUARD', attachAdvisory, summarize: true }).content).toContain('GUARD');
  });
});

describe('fitToolText + modelToolResultPolicy', () => {
  it('fitToolText falls back to head+tail for non-logs', () => {
    const text = Array.from({ length: 1_000 }, (_, i) => `r${i}`).join('\n');
    expect(fitToolText(text, 1_000)).toContain('elided');
    expect(fitToolText(text, 1_000, { fallback: (t, m) => t.slice(0, m) })).toBe(text.slice(0, 1_000));
  });
  it('builds the codec serializer', () => {
    const policy = modelToolResultPolicy({ summarize: true });
    expect(policy('x', { a: 1 })).toBe('{"a":1}');
    expect(policy('x', null)).toBe('null');
  });
});
