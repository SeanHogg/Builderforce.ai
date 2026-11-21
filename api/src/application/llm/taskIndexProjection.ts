/**
 * `tasks.list { fields: "index" }` — one `id|status|type|parent|title` line per ticket,
 * the survey shape the tool-output policy recognises (`isIndexResult`) and serves under
 * its larger {@link INDEX_RESULT_CHARS} cap.
 *
 * The page is bounded by the SAME budget the policy enforces, not only by row count:
 * titles vary in length, and an index cut by the transcript cap would lose rows silently
 * (the envelope says `returned: 300` and the model sees 260). Here a page stops at the
 * budget and `nextOffset` continues from the first ticket that did not fit. When the
 * SERVED cap is smaller still (a small model window, an explicit surface cap, a loop-guard
 * advisory riding along), the policy re-pages it at a line boundary and rewrites
 * `returned`/`nextOffset` (`shapeToolResult`), so no middle line is ever skipped. The
 * envelope keys come BEFORE `lines`, so even a cut result keeps its paging fields.
 */
import { INDEX_RESULT_CHARS, TASK_INDEX_FORMAT } from '@builderforce/tool-output-policy';
import { clampCount } from './listProjection';

type Row = Record<string, unknown>;

/** Index pages may hold more rows than a compact page: ~80 chars a row. */
export const TASK_INDEX_DEFAULT_LIMIT = 300;
export const TASK_INDEX_MAX_LIMIT = 300;
// The column header is the policy's (`TASK_INDEX_FORMAT`), so its index cap recognises this page.
export { TASK_INDEX_FORMAT };

/** Room left for the envelope (`format`, counts, `scope`, `nextOffset`, quotes). */
const ENVELOPE_CHARS = 400;
const TITLE_CHARS = 90;

function titleOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const one = value.replace(/\s+/g, ' ').trim();
  return one.length > TITLE_CHARS ? `${one.slice(0, TITLE_CHARS)}…` : one;
}

function indexLine(row: Row): string {
  return `${row.id}|${row.status ?? ''}|${row.taskType ?? ''}|${row.parentTaskId ?? ''}|${titleOf(row.title)}`;
}

/** Clamp a caller-supplied index `limit` into `[1, TASK_INDEX_MAX_LIMIT]` (the ONE count clamp). */
export function clampIndexLimit(v: unknown): number {
  return clampCount(v, TASK_INDEX_DEFAULT_LIMIT, TASK_INDEX_MAX_LIMIT);
}

/** One index line per row, for callers that only need the lines (a dry-run sample). */
export function taskIndexLines(rows: readonly Row[]): string[] {
  return rows.map(indexLine);
}

/**
 * The index envelope over ONE page already cut by the database (`pageRows` start at
 * `offset`; `total` is the full match count). The page stops at the char budget and
 * `nextOffset` resumes at the first row that did not fit. Pure.
 */
export function projectTaskIndexPage(pageRows: readonly Row[], offset: number, total: number, scope: string, budget = INDEX_RESULT_CHARS - ENVELOPE_CHARS) {
  const lines: string[] = [];
  let used = 0;
  for (const row of pageRows) {
    const line = indexLine(row);
    // Serialized cost: JSON escaping plus the `\n` separator.
    const cost = JSON.stringify(line).length;
    if (lines.length > 0 && used + cost > budget) break;
    lines.push(line);
    used += cost;
  }
  const end = offset + lines.length;
  const truncated = total > end;
  return {
    format: TASK_INDEX_FORMAT,
    total,
    returned: lines.length,
    offset,
    truncated,
    ...(truncated ? { nextOffset: end } : {}),
    scope,
    lines: lines.join('\n'),
  };
}
