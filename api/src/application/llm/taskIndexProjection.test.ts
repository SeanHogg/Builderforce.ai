import { describe, expect, it } from 'vitest';
import { INDEX_RESULT_CHARS, isIndexResult, shapeToolResult } from '@builderforce/tool-output-policy';
import { clampIndexLimit, projectTaskIndexPage, TASK_INDEX_MAX_LIMIT } from './taskIndexProjection';

/** The page a database cut at `offset`/`limit` hands the projection, over the full set. */
const projectTaskIndex = (all: ReadonlyArray<Record<string, unknown>>, offset: number, limit: number, scope: string) =>
  projectTaskIndexPage(all.slice(offset, offset + limit), offset, all.length, scope);

const rows = (n: number, title = 'A ticket title of a typical length for this board') =>
  Array.from({ length: n }, (_, i) => ({ id: 6000 + i, status: 'backlog', taskType: 'task', parentTaskId: i % 3 ? 5000 : null, title }));

describe('tasks.list index projection', () => {
  // regression: chat #273 — under the 6K default an index page held ~70 tickets, so a
  // 1,253-ticket board took ~18 calls to survey.
  it('serves ~300 typical tickets in one page, whole, under the policy cap', () => {
    const page = projectTaskIndex(rows(1253), 0, clampIndexLimit(undefined), 'open');
    expect(page.returned).toBe(TASK_INDEX_MAX_LIMIT);
    expect(page).toMatchObject({ total: 1253, offset: 0, truncated: true, nextOffset: 300 });
    expect(isIndexResult('builtin_tasks_list', page)).toBe(true);
    const shaped = shapeToolResult('builtin_tasks_list', page);
    expect(shaped.truncated).toBe(false);
    expect(shaped.content.length).toBeLessThanOrEqual(INDEX_RESULT_CHARS);
  });

  it('stops a page at the char budget and continues from the first ticket that did not fit', () => {
    const page = projectTaskIndex(rows(300, 'x'.repeat(200)), 0, 300, 'open');
    expect(page.returned).toBeLessThan(300);
    expect(page.nextOffset).toBe(page.returned);
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(INDEX_RESULT_CHARS);
  });

  it('a small model window serves a whole-line prefix and continues from the first dropped ticket', () => {
    const page = projectTaskIndex(rows(1253), 0, 300, 'open');
    const shaped = shapeToolResult('builtin_tasks_list', page, { contextWindowTokens: 8_000 });
    expect(shaped.truncated).toBe(true);
    const served = JSON.parse(shaped.content) as { lines: string; returned: number; nextOffset: number };
    const ids = served.lines.split('\n').map((l) => Number(l.split('|')[0]));
    expect(ids).toEqual(Array.from({ length: served.returned }, (_, i) => 6000 + i));
    expect(served.nextOffset).toBe(served.returned);
  });

  it('keeps the paging envelope ahead of the lines', () => {
    const keys = Object.keys(projectTaskIndex(rows(3), 0, 2, 'all'));
    expect(keys.indexOf('nextOffset')).toBeLessThan(keys.indexOf('lines'));
  });

  it('clamps the requested limit', () => {
    expect(clampIndexLimit(5000)).toBe(TASK_INDEX_MAX_LIMIT);
    expect(clampIndexLimit(0)).toBe(1);
    expect(clampIndexLimit('abc')).toBe(TASK_INDEX_MAX_LIMIT);
    // A fraction never reaches SQL as a LIMIT.
    expect(clampIndexLimit(2.7)).toBe(2);
  });
});
