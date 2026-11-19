import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_OUTPUT_CHARS, INDEX_RESULT_CHARS, TASK_INDEX_FORMAT, isIndexResult, resultTableCap, shapeToolResult } from './index.js';

const TOOL = 'builtin_tasks_list';
const index = (lines: number, format = TASK_INDEX_FORMAT) => ({
  format, total: lines + 1000, returned: lines, offset: 0, truncated: true, nextOffset: lines, scope: 'open',
  lines: Array.from({ length: lines }, (_, i) => `${i}|backlog|task||A ticket title of a typical length`).join('\n'),
});

describe('index survey results', () => {
  it('recognises only the known producer returning a known format', () => {
    expect(isIndexResult(TOOL, index(2))).toBe(true);
    expect(isIndexResult('tasks.list', index(2))).toBe(true);
    expect(isIndexResult(TOOL, index(2, 'a|b'))).toBe(false);
    expect(isIndexResult(TOOL, { tasks: [] })).toBe(false);
    expect(isIndexResult(TOOL, [index(2)])).toBe(false);
  });

  it('a spoofing tool returning the same shape gets no larger cap', () => {
    for (const tool of ['web_fetch', 'mcp__evil__dump', 'read_file']) {
      expect(isIndexResult(tool, index(400))).toBe(false);
    }
    expect(shapeToolResult('mcp__evil__dump', index(400)).truncated).toBe(true);
    expect(shapeToolResult('mcp__evil__dump', index(400)).content.length).toBeLessThan(DEFAULT_TOOL_OUTPUT_CHARS + 400);
  });

  it('raises the cap for an index result, leaves other results of the same tool alone', () => {
    expect(resultTableCap(TOOL, index(1))).toBe(INDEX_RESULT_CHARS);
    expect(resultTableCap(TOOL, { tasks: [] })).toBe(DEFAULT_TOOL_OUTPUT_CHARS);
  });

  it('serves a ~20K index whole with the C7 lever on or off', () => {
    const out = index(400);
    expect(JSON.stringify(out).length).toBeGreaterThan(DEFAULT_TOOL_OUTPUT_CHARS);
    expect(shapeToolResult(TOOL, out).truncated).toBe(false);
    expect(shapeToolResult(TOOL, out, { summarize: true }).truncated).toBe(false);
  });

  it('still cuts compact/slim JSON rows of the same tool at the generic cap', () => {
    const slim = { tasks: Array.from({ length: 60 }, (_, i) => ({ id: i, title: 'Slim row title', descriptionSnippet: 'x'.repeat(300) })), total: 60 };
    const shaped = shapeToolResult(TOOL, slim);
    expect(shaped.truncated).toBe(true);
    expect(shaped.content.length).toBeLessThan(DEFAULT_TOOL_OUTPUT_CHARS + 400);
  });

  // A small window (or an explicit cap) serves less than the producer's page: the cut is at
  // a LINE and the paging continues from the first dropped line — nothing in the middle is lost.
  it('pages an index over a small served cap at a line boundary, with nextOffset rewritten', () => {
    for (const opts of [{ contextWindowTokens: 8_000 }, { maxChars: 1_000 }, { contextWindowTokens: 8_000, advisory: 'GUARD '.repeat(40), attachAdvisory: (v: unknown, a: string) => ({ ...(v as object), note: a }) }]) {
      const shaped = shapeToolResult(TOOL, index(400), opts);
      expect(shaped.truncated).toBe(true);
      const served = JSON.parse(shaped.content) as { lines: string; returned: number; nextOffset: number; truncated: boolean };
      const lines = served.lines.split('\n');
      expect(lines.length).toBe(served.returned);
      expect(served.nextOffset).toBe(served.returned);
      expect(lines.at(-1)).toBe(`${served.returned - 1}|backlog|task||A ticket title of a typical length`);
    }
  });
});
