/**
 * textDiff — a tiny, dependency-free line diff (LCS based).
 *
 * Used by PromptVersionDiff to compare two prompt versions. Computes the longest
 * common subsequence of lines, then walks the backtrace into an ordered list of
 * rows tagged equal / added / removed. A unified view renders the rows directly;
 * a side-by-side view pairs removed+added runs.
 */

export type DiffOp = 'equal' | 'add' | 'remove';

export interface DiffRow {
  op: DiffOp;
  /** Line text. */
  text: string;
  /** 1-based line number in the OLD text (null for added lines). */
  oldLine: number | null;
  /** 1-based line number in the NEW text (null for removed lines). */
  newLine: number | null;
}

/** Split into lines without a trailing empty element for a final newline. */
function toLines(s: string): string[] {
  if (s === '') return [];
  const lines = s.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Diff `oldText` → `newText` at line granularity. O(n*m) time/space — fine for
 * prompt bodies (bounded, human-sized). Returns rows in display order.
 */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = toLines(oldText);
  const b = toLines(newText);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ op: 'equal', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ op: 'remove', text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      rows.push({ op: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) { rows.push({ op: 'remove', text: a[i], oldLine: i + 1, newLine: null }); i++; }
  while (j < m) { rows.push({ op: 'add', text: b[j], oldLine: null, newLine: j + 1 }); j++; }

  return rows;
}

export interface DiffStat { added: number; removed: number; unchanged: number }

/** Count added / removed / unchanged lines for a summary chip. */
export function diffStat(rows: DiffRow[]): DiffStat {
  let added = 0, removed = 0, unchanged = 0;
  for (const r of rows) {
    if (r.op === 'add') added++;
    else if (r.op === 'remove') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}

export interface SideBySideRow {
  left: { text: string; line: number } | null;
  right: { text: string; line: number } | null;
  changed: boolean;
}

/**
 * Fold the unified rows into aligned left/right pairs for a side-by-side view:
 * a run of removals is zipped against the following run of additions so edits sit
 * on the same visual row.
 */
export function sideBySide(rows: DiffRow[]): SideBySideRow[] {
  const out: SideBySideRow[] = [];
  let k = 0;
  while (k < rows.length) {
    const r = rows[k];
    if (r.op === 'equal') {
      out.push({ left: { text: r.text, line: r.oldLine! }, right: { text: r.text, line: r.newLine! }, changed: false });
      k++;
      continue;
    }
    // Gather a contiguous run of removes then adds.
    const removes: DiffRow[] = [];
    const adds: DiffRow[] = [];
    while (k < rows.length && rows[k].op === 'remove') removes.push(rows[k++]);
    while (k < rows.length && rows[k].op === 'add') adds.push(rows[k++]);
    const max = Math.max(removes.length, adds.length);
    for (let x = 0; x < max; x++) {
      const l = removes[x];
      const rr = adds[x];
      out.push({
        left: l ? { text: l.text, line: l.oldLine! } : null,
        right: rr ? { text: rr.text, line: rr.newLine! } : null,
        changed: true,
      });
    }
  }
  return out;
}
