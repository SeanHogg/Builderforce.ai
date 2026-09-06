import { describe, it, expect } from 'vitest';
import { trimToolResult, MAX_TOOL_RESULT_CHARS, READ_FILE_RESULT_CHARS } from './toolResultBudget';

/** A file of `n` lines, each unique and long enough that a few hundred overflow the budget. */
function bigFile(n: number, width = 60): string {
  return Array.from({ length: n }, (_, i) => `line ${String(i + 1).padStart(4, '0')} ${'x'.repeat(width)}`).join('\n');
}

const parse = (s: string): Record<string, unknown> => JSON.parse(s) as Record<string, unknown>;

describe('trimToolResult · read_file is paged by line', () => {
  it('leaves a read that fits untouched', () => {
    const out = { ok: true, path: 'a.ts', content: 'one\ntwo', truncated: false, totalLines: 2, offset: 1 };
    const t = trimToolResult('read_file', out);
    expect(t.truncated).toBe(false);
    expect(parse(t.content)).toEqual(out);
    expect(t.bytes).toBe(JSON.stringify(out).length);
  });

  it('cuts an oversized read at a LINE boundary, within the read budget', () => {
    const content = bigFile(600);
    const out = { ok: true, path: 'big.ts', content, truncated: false, totalLines: 600, offset: 1 };
    const t = trimToolResult('read_file', out);
    expect(t.truncated).toBe(true);
    expect(t.content.length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    const shown = parse(t.content);
    const lines = String(shown.content).split('\n');
    // Every line handed over is a WHOLE line — no half-line at the cut.
    expect(lines[lines.length - 1]).toMatch(/^line \d{4} x+$/);
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.length).toBeLessThan(600);
  });

  it('keeps the paging fields and names the exact offset that continues the read', () => {
    const out = { ok: true, path: 'big.ts', content: bigFile(600), truncated: false, totalLines: 600, offset: 1 };
    const shown = parse(trimToolResult('read_file', out).content);
    const kept = String(shown.content).split('\n').length;
    expect(shown.ok).toBe(true);
    expect(shown.path).toBe('big.ts');
    expect(shown.offset).toBe(1);
    expect(shown.totalLines).toBe(600);
    expect(shown.truncated).toBe(true);
    expect(String(shown.note)).toContain(`Showing lines 1–${kept} of 600`);
    expect(String(shown.note)).toContain(`offset ${kept + 1}`);
    // The old cap sliced the JSON here and lost every one of these fields.
    expect(shown.note).not.toBeUndefined();
  });

  it('carries a non-1 offset through, so a second window continues from the right line', () => {
    const out = { ok: true, path: 'big.ts', content: bigFile(600), truncated: true, totalLines: 1200, offset: 601, note: 'tool note' };
    const shown = parse(trimToolResult('read_file', out).content);
    const kept = String(shown.content).split('\n').length;
    expect(shown.offset).toBe(601);
    expect(shown.totalLines).toBe(1200);
    expect(String(shown.note)).toContain(`Showing lines 601–${600 + kept} of 1200`);
    expect(String(shown.note)).toContain(`offset ${601 + kept}`);
  });

  it('reports the ORIGINAL size as bytes — what the diagnostics count as flooding', () => {
    const out = { ok: true, content: bigFile(600), totalLines: 600, offset: 1 };
    const t = trimToolResult('read_file', out);
    expect(t.bytes).toBe(JSON.stringify(out).length);
    expect(t.bytes).toBeGreaterThan(READ_FILE_RESULT_CHARS);
  });

  it('attaches the loop-guard advisory AFTER the cut, so the budget cannot delete it', () => {
    const out = { ok: true, content: bigFile(600), totalLines: 600, offset: 1 };
    const shown = parse(trimToolResult('read_file', out, { advisory: 'STOP RE-READING' }).content);
    expect(String(shown.note)).toContain('STOP RE-READING');
    expect(String(shown.note)).toContain('Showing lines');
  });

  it('attaches the advisory to a read that fits, too', () => {
    const shown = parse(trimToolResult('read_file', { ok: true, content: 'x', totalLines: 1, offset: 1 }, { advisory: 'careful' }).content);
    expect(shown.note).toBe('careful');
    expect(shown.content).toBe('x');
  });

  it('hands over as much of a single monstrous line as fits and says paging cannot reach the rest', () => {
    const out = { ok: true, content: 'y'.repeat(READ_FILE_RESULT_CHARS * 2), totalLines: 1, offset: 1 };
    const t = trimToolResult('read_file', out);
    expect(t.content.length).toBeLessThanOrEqual(READ_FILE_RESULT_CHARS);
    const shown = parse(t.content);
    expect(String(shown.note)).toMatch(/longer than/);
    expect(String(shown.note)).toContain('search_code');
    expect(shown.truncated).toBe(true);
  });

  it('treats a FAILED read like any other result (nothing to page)', () => {
    const out = { ok: false, error: 'file not found', content: undefined };
    const t = trimToolResult('read_file', out);
    expect(t.truncated).toBe(false);
    expect(parse(t.content).error).toBe('file not found');
  });
});

describe('trimToolResult · every other tool keeps the generic head slice', () => {
  it('leaves a small result alone', () => {
    const t = trimToolResult('builtin_tasks_list', [{ id: 1 }]);
    expect(t.truncated).toBe(false);
    expect(t.content).toBe('[{"id":1}]');
  });

  it('head-slices a big list and says how many items it held', () => {
    const rows = Array.from({ length: 352 }, (_, i) => ({ id: i, title: `task ${i}`, description: 'd'.repeat(40) }));
    const t = trimToolResult('builtin_tasks_list', rows);
    expect(t.truncated).toBe(true);
    expect(t.content.startsWith('[{"id":0')).toBe(true);
    expect(t.content).toContain('352 items');
    expect(t.content.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 400);
  });

  it('keeps the advisory visible after the marker on a trimmed result', () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, pad: 'p'.repeat(40) }));
    const t = trimToolResult('search_code', rows, { advisory: 'you have read this 3 times' });
    expect(t.content.endsWith('you have read this 3 times')).toBe(true);
  });

  it('folds the advisory into a fitting object result as its note', () => {
    const shown = parse(trimToolResult('search_code', { ok: true, matches: [] }, { advisory: 'careful' }).content);
    expect(shown.note).toBe('careful');
    expect(shown.matches).toEqual([]);
  });
});
