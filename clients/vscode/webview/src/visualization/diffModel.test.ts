import { describe, expect, it } from 'vitest';

import { parseUnifiedDiff } from './diffModel';
import { MODIFIED, diff } from './diffFixtures.test-util';

/**
 * The parsing and the graph ARE the feature: every BEFORE/AFTER pair the
 * Visualization tab shows is derived from these two pure functions, and a
 * mis-numbered row or a dropped file is something the user cannot reconcile with
 * the Source Control view sitting right next to it. So the tests assert exact line
 * numbers, exact row kinds and exact counts — not merely "it did not throw".
 */

describe('parseUnifiedDiff', () => {
  it('reads a modified hunk with correct line numbers and row kinds', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file).toMatchObject({ path: 'src/app/run.ts', tracked: true, added: 2, removed: 1 });
    expect(file?.hunks).toHaveLength(1);

    const hunk = file!.hunks[0]!;
    expect(hunk.header).toBe('@@ -10,4 +10,5 @@ export function run() {');
    expect([hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]).toEqual([10, 4, 10, 5]);
    // Only the leading marker is stripped: the line's own indentation survives, which
    // is what makes an indented row read as code rather than as a column of text.
    expect(hunk.rows).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10, text: 'const started = Date.now();' },
      { kind: 'del', oldLine: 11, text: '  const done = false;' },
      { kind: 'add', newLine: 11, text: '  const done = await settle();' },
      { kind: 'add', newLine: 12, text: '  const elapsed = Date.now() - started;' },
      { kind: 'context', oldLine: 12, newLine: 13, text: 'return done;' },
    ]);
    // A deleted line has no line number on the NEW side, and vice versa.
    expect(hunk.rows[1]?.newLine).toBeUndefined();
    expect(hunk.rows[2]?.oldLine).toBeUndefined();
  });

  it('defaults the omitted ,1 counts of a one-line hunk to 1', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -3 +7 @@',
        '-const before = 1;',
        '+const after = 2;',
      ),
    );
    expect(file?.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 7, newLines: 1 });
  });

  it('reads a pure addition — no old side, every row new', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/new.ts b/src/new.ts',
        'new file mode 100644',
        'index 0000000..1234567',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1,2 @@',
        '+export const a = 1;',
        '+export const b = 2;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new.ts', added: 2, removed: 0, tracked: true });
    expect(file?.hunks[0]?.rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['add', undefined, 1],
      ['add', undefined, 2],
    ]);
  });

  it('reads a pure deletion — no new side, every row old', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old.ts b/src/old.ts',
        'deleted file mode 100644',
        'index 1234567..0000000',
        '--- a/src/old.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-export const gone = true;',
        '-export const alsoGone = true;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/old.ts', added: 0, removed: 2, tracked: true });
    expect(file?.hunks[0]?.rows.map((r) => [r.kind, r.oldLine, r.newLine])).toEqual([
      ['del', 1, undefined],
      ['del', 2, undefined],
    ]);
  });

  it('strips the a/ and b/ prefixes and the no-newline marker', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/docs/readme.md b/docs/readme.md',
        '--- a/docs/readme.md',
        '+++ b/docs/readme.md',
        '@@ -1,2 +1,2 @@',
        ' hello',
        '-goodbye',
        '+farewell',
        '\\ No newline at end of file',
      ),
    );
    expect(file?.path).toBe('docs/readme.md');
    expect(file?.hunks[0]?.rows).toHaveLength(3);
  });

  it('reports an untracked file as untracked, with no hunks', () => {
    const [file] = parseUnifiedDiff('', ['src/brand-new.ts']);
    expect(file).toEqual({ path: 'src/brand-new.ts', hunks: [], added: 0, removed: 0, tracked: false });
  });

  it('lists a brand-new file alongside the tracked ones', () => {
    const files = parseUnifiedDiff(MODIFIED, ['src/brand-new.ts']);
    expect(files.map((f) => f.path)).toEqual(['src/app/run.ts', 'src/brand-new.ts']);
    expect(files[1]?.tracked).toBe(false);
    // The modified file keeps its diff — listing it as untracked does not clear it.
    expect(files[0]?.tracked).toBe(true);
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('reports a rename under its new name', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old/name.ts b/src/new/name.ts',
        'similarity index 92%',
        'rename from src/old/name.ts',
        'rename to src/new/name.ts',
        '--- a/src/old/name.ts',
        '+++ b/src/new/name.ts',
        '@@ -1,1 +1,1 @@',
        '-const before = 1;',
        '+const after = 2;',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new/name.ts', added: 1, removed: 1, tracked: true });
  });

  it('reads a rename that has no hunks at all', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old/name.ts b/src/new/name.ts',
        'similarity index 100%',
        'rename from src/old/name.ts',
        'rename to src/new/name.ts',
      ),
    );
    expect(file).toMatchObject({ path: 'src/new/name.ts', hunks: [], tracked: true });
  });

  it('splits a multi-file diff into one entry per file', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -5,2 +5,2 @@',
        ' keep',
        '-old',
        '+new',
        'diff --git a/src/c.ts b/src/c.ts',
        '--- a/src/c.ts',
        '+++ b/src/c.ts',
        '@@ -9 +9 @@',
        '-gone',
        '+back',
      ),
    );
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ['src/a.ts', 1, 1],
      ['src/b.ts', 1, 1],
      ['src/c.ts', 1, 1],
    ]);
    expect(files[1]?.hunks[0]?.rows).toHaveLength(3);
    expect(files[1]?.hunks[0]?.newStart).toBe(5);
  });

  it('yields zero hunks for a binary file rather than failing', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/assets/logo.png b/assets/logo.png',
        'index 1234567..89abcde 100644',
        'Binary files a/assets/logo.png and b/assets/logo.png differ',
      ),
    );
    expect(file).toEqual({ path: 'assets/logo.png', hunks: [], added: 0, removed: 0, tracked: true });
  });

  it('keeps going after a truncated header instead of throwing', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git ',
        'this is not a diff at all',
        '@@ nonsense @@',
        '---',
        '+++',
        'diff --git a/src/ok.ts b/src/ok.ts',
        '--- a/src/ok.ts',
        '+++ b/src/ok.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(files[0]?.added).toBe(1);
  });

  it('does not throw on empty, whitespace or binary-patch input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n\n')).toEqual([]);
    // A patch with no readable header names no file, so it names no diff either.
    expect(parseUnifiedDiff(diff('GIT binary patch', 'literal 12', 'zcmZ?wbhEHb'))).toEqual([]);
  });

  it('reads a plain diff with no diff --git header and no prefixes', () => {
    const [file] = parseUnifiedDiff(diff('--- src/plain.ts', '+++ src/plain.ts', '@@ -1 +1 @@', '-a', '+b'));
    expect(file).toMatchObject({ path: 'src/plain.ts', added: 1, removed: 1 });
  });

  it('reads a header path git quoted because it contains a space', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git "a/src/my file.ts" "b/src/my file.ts"',
        '--- "a/src/my file.ts"',
        '+++ "b/src/my file.ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(file?.path).toBe('src/my file.ts');
  });

  it('does not mistake a deleted line whose text starts --- for a header', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/doc.ts b/src/doc.ts',
        '--- a/src/doc.ts',
        '+++ b/src/doc.ts',
        '@@ -1,3 +1,3 @@',
        ' intro',
        '--- a section ---',
        '-++ not an added line',
        ' tail',
      ),
    );
    expect(file?.path).toBe('src/doc.ts');
    expect(file?.hunks[0]?.rows.map((r) => r.kind)).toEqual(['context', 'del', 'del', 'context']);
    expect(file?.hunks[0]?.rows[2]?.text).toBe('++ not an added line');
  });

  it('treats a stripped blank line inside a hunk as context, not as a terminator', () => {
    const [file] = parseUnifiedDiff(
      diff('diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1,3 +1,4 @@', ' a', '', '+b', ' c'),
    );
    expect(file?.hunks[0]?.rows).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'context', oldLine: 2, newLine: 2, text: '' },
      { kind: 'add', newLine: 3, text: 'b' },
      { kind: 'context', oldLine: 3, newLine: 4, text: 'c' },
    ]);
  });
});
