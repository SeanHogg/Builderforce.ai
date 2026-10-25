import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_OUTPUT_CHARS,
  READ_FILE_MAX_CHARS,
  READ_FILE_RESULT_CHARS,
  shapeToolResult,
  sliceReadFile,
  toolOutputCap,
  windowReadFile,
  windowReadFiles,
  windowedCap,
} from './index.js';

const numbered = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${from + i} ${'x'.repeat(55)}`).join('\n');
const bigRead = (n = 2000) => ({ ok: true, path: 'big.ts', content: numbered(n), offset: 1, totalLines: n, truncated: false });
const attachAdvisory = (r: unknown, a: string) => ({ ...(r as object), note: a });

describe('windowedCap (PRD 35 E4: one window-sized cap)', () => {
  it('keeps the table row when the window is unknown', () => {
    expect(windowedCap('read_file', 16_000)).toBe(16_000);
    expect(windowedCap('run_command', 20_000, undefined)).toBe(20_000);
    expect(windowedCap('run_command', 20_000, 0)).toBe(20_000);
    expect(windowedCap('run_command', 20_000, Number.NaN)).toBe(20_000);
  });

  it('clamps read_file to [table row, 64K] by the window share', () => {
    // 8k window → 9,600-char share: below the floor, so the 16K row stands.
    expect(windowedCap('read_file', 16_000, 8_000)).toBe(16_000);
    // 32k window → 38,400 chars.
    expect(windowedCap('read_file', 16_000, 32_000)).toBe(38_400);
    // 200k window → 240,000 chars: capped at the read_file maximum.
    expect(windowedCap('read_file', 16_000, 200_000)).toBe(READ_FILE_MAX_CHARS);
    expect(READ_FILE_MAX_CHARS).toBe(64_000);
  });

  it('never lets another tool exceed its row, and shrinks it on a small window', () => {
    expect(windowedCap('run_command', 20_000, 200_000)).toBe(20_000);
    expect(windowedCap('run_command', 20_000, 8_000)).toBe(9_600);
    expect(windowedCap('tasks.list', DEFAULT_TOOL_OUTPUT_CHARS, 4_000)).toBe(4_800);
  });
});

describe('shapeToolResult with a context window', () => {
  it('hands a large window a bigger read_file page, never above 64K', () => {
    const unknown = shapeToolResult('read_file', bigRead());
    const large = shapeToolResult('read_file', bigRead(), { contextWindowTokens: 200_000 });
    expect(unknown.content.length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    expect(large.content.length).toBeGreaterThan(READ_FILE_RESULT_CHARS);
    expect(large.content.length).toBeLessThanOrEqual(READ_FILE_MAX_CHARS);
    expect(large.truncated).toBe(true);
  });

  it('shrinks a non-read result on a small window, and an explicit maxChars still wins', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, title: `task ${i}` }));
    const table = shapeToolResult('tasks.list', rows);
    const small = shapeToolResult('tasks.list', rows, { contextWindowTokens: 4_000 });
    expect(small.truncated).toBe(true);
    expect(small.content.length).toBeLessThan(table.content.length);
    const explicit = shapeToolResult('tasks.list', rows, { contextWindowTokens: 4_000, maxChars: 1_000 });
    expect(explicit.content.length).toBeLessThan(small.content.length);
  });

  it('keeps today\'s caps with no window', () => {
    expect(toolOutputCap('read_file')).toBe(16_000);
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, title: `task ${i}` }));
    expect(shapeToolResult('tasks.list', rows, { contextWindowTokens: undefined })).toEqual(shapeToolResult('tasks.list', rows));
  });
});

describe('the served window (PRD 35 E1)', () => {
  it('reports what the model was served, before the advisory', () => {
    const shaped = shapeToolResult('read_file', bigRead(), { advisory: 'GUARD', attachAdvisory });
    expect(shaped.content).toContain('GUARD');
    expect(shaped.served).toBeDefined();
    expect(String(shaped.served!.note)).not.toContain('GUARD');
    expect(shaped.served!.truncated).toBe(true);
    expect(shaped.served!.totalLines).toBe(2000);
    const servedLines = String(shaped.served!.content).split('\n');
    expect(servedLines.length).toBeLessThan(2000);
    expect(servedLines.at(-1)).toMatch(new RegExp(`^line ${servedLines.length} `));
  });

  it('serves a whole small file as-is', () => {
    const small = { ok: true, path: 'a.ts', content: 'a\nb', offset: 1, totalLines: 2, truncated: false };
    const w = windowReadFile(small);
    expect(w.truncated).toBe(false);
    expect(w.served).toEqual(small);
  });

  it('carries no served window for a non-read tool', () => {
    expect(shapeToolResult('tasks.list', [{ id: 1 }]).served).toBeUndefined();
  });
});

describe('windowReadFiles (read_file paths[])', () => {
  it('keeps a small file whole and pages the big one, inside one budget', () => {
    const small = { ok: true, path: 'a.ts', content: 'one\ntwo\nthree', offset: 1, totalLines: 3, truncated: false };
    const out = { ok: true, files: [bigRead(), small] };
    const w = windowReadFiles(out, { maxChars: READ_FILE_RESULT_CHARS });
    expect(JSON.stringify(w.value).length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    expect(w.truncated).toBe(true);
    const [big, kept] = w.served.files as Array<Record<string, unknown>>;
    expect(kept).toEqual(small);
    expect(big.path).toBe('big.ts');
    expect(big.truncated).toBe(true);
    expect(big.offset).toBe(1);
    expect(String(big.note)).toMatch(/offset \d+/);
  });

  it('passes a failed entry through and attaches the advisory to the whole result', () => {
    const missing = { ok: false, path: 'gone.ts', error: 'not found' };
    const out = { ok: true, files: [missing, bigRead(50)] };
    const w = windowReadFiles(out, { advisory: 'GUARD', attachAdvisory });
    expect((w.served.files as unknown[])[0]).toEqual(missing);
    expect(w.value.note).toBe('GUARD');
    expect(w.served.note).toBeUndefined();
    expect(w.truncated).toBe(false);
  });

  it('is what shapeToolResult uses for a multi-file read', () => {
    const shaped = shapeToolResult('read_file', { ok: true, files: [bigRead(), bigRead()] });
    expect(shaped.truncated).toBe(true);
    expect(shaped.content.length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    expect((JSON.parse(shaped.content) as { files: unknown[] }).files).toHaveLength(2);
  });
});

describe('sliceReadFile (a covered-read replay serves the REQUESTED window)', () => {
  const covering = { ok: true, path: 'big.ts', content: numbered(246, 200), offset: 200, totalLines: 534, truncated: true, note: 'Showing lines 200–445 of 534.' };

  it('starts at the requested line, not the covering read\'s first', () => {
    const slice = sliceReadFile(covering, 251, 300);
    const lines = String(slice.content).split('\n');
    expect(lines[0]).toMatch(/^line 251 /);
    expect(lines).toHaveLength(50);
    expect(slice.offset).toBe(251);
    expect(slice.totalLines).toBe(534);
    expect(slice.truncated).toBe(true);
    expect(String(slice.note)).toMatch(/offset 301/);
    expect(slice.path).toBe('big.ts');
  });

  it('marks a slice that reaches EOF complete', () => {
    const tail = { ok: true, path: 'a.ts', content: numbered(10, 1), offset: 1, totalLines: 10, truncated: false };
    const slice = sliceReadFile(tail, 6, 2000);
    expect(String(slice.content).split('\n')).toHaveLength(5);
    expect(slice.truncated).toBe(false);
    expect(slice.note).toBeUndefined();
  });
});
