/**
 * Dependency-free line-based unified diff, for putting a run's actual code
 * changes (the "transaction") into a paste-able text report. Reviewers (human or
 * model) read the diff exactly like a PR patch.
 *
 * Produces git-style `-`/`+`/` ` lines with long unchanged runs collapsed to a
 * context marker, so a small edit in a big file stays compact. Falls back to
 * "new content only" when a side is too large to diff cheaply (the panel already
 * truncates very large files upstream).
 */

const MAX_DIFF_LINES = 1200; // LCS table is O(n*m); cap to keep it cheap.
const CONTEXT = 3; // unchanged lines of context kept around each change.

type DiffLine = { tag: ' ' | '-' | '+'; text: string };

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ tag: ' ', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ tag: '-', text: a[i] }); i++; }
    else { out.push({ tag: '+', text: b[j] }); j++; }
  }
  while (i < n) { out.push({ tag: '-', text: a[i] }); i++; }
  while (j < m) { out.push({ tag: '+', text: b[j] }); j++; }
  return out;
}

/** Collapse runs of >2*CONTEXT unchanged lines into a `@@ … N lines … @@` marker. */
function collapseContext(lines: DiffLine[]): string[] {
  const changedAt = lines.map((l) => l.tag !== ' ');
  const keep = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (changedAt[i]) {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) keep[k] = true;
    }
  }
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep[i]) { out.push(lines[i].tag + lines[i].text); i++; continue; }
    let j = i;
    while (j < lines.length && !keep[j]) j++;
    out.push(`@@ … ${j - i} unchanged line${j - i === 1 ? '' : 's'} … @@`);
    i = j;
  }
  return out;
}

/**
 * A unified diff for one file change. `change` drives created/deleted rendering.
 * Returns a `\`\`\`diff` fenced block ready to drop into a markdown report.
 */
export function unifiedDiff(
  path: string,
  change: 'created' | 'modified' | 'deleted',
  base: string | null,
  current: string | null,
): string {
  const header = `### ${change.toUpperCase()} ${path}`;
  if (change === 'created' || base == null) {
    const body = (current ?? '').split('\n').map((l) => '+' + l).join('\n');
    return `${header}\n\`\`\`diff\n${body}\n\`\`\``;
  }
  if (change === 'deleted' || current == null) {
    const body = (base ?? '').split('\n').map((l) => '-' + l).join('\n');
    return `${header}\n\`\`\`diff\n${body}\n\`\`\``;
  }
  const a = base.split('\n');
  const b = current.split('\n');
  if (a.length + b.length > MAX_DIFF_LINES) {
    // Too large to diff cheaply — show the new content so it's still reviewable.
    return `${header}\n(file too large for an inline diff — new content)\n\`\`\`\n${current}\n\`\`\``;
  }
  const body = collapseContext(lcsDiff(a, b)).join('\n');
  return `${header}\n\`\`\`diff\n${body}\n\`\`\``;
}
