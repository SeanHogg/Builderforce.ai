import { describe, expect, it } from 'vitest';
import { classifyDiffPath, summarizeDiffFiles } from './getPullRequestDiffSummary';

describe('pull request diff summary', () => {
  it.each([
    ['src/app.ts', 'code'],
    ['src/app.test.ts', 'test'],
    ['tests/e2e/login.ts', 'test'],
    ['specs/tasks/task-1.md', 'docs'],
    ['api/migrations/0400_add.sql', 'migration'],
    ['.github/workflows/ci.yml', 'config'],
    ['public/logo.png', 'asset'],
    ['NOTICE', 'other'],
  ])('classifies %s as %s', (path, category) => {
    expect(classifyDiffPath(path)).toBe(category);
  });

  it('returns category totals and delivery flags', () => {
    const result = summarizeDiffFiles([
      { filename: 'docs/plan.md', additions: 10, deletions: 1 },
      { filename: 'src/app.ts', additions: 5, deletions: 2 },
      { filename: 'src/app.test.ts', additions: 8, deletions: 0 },
    ]);
    expect(result.totals).toMatchObject({ files: 3, additions: 23, deletions: 3 });
    expect(result.totals.byCategory).toMatchObject({ docs: 1, code: 1, test: 1 });
    expect(result.docsOnly).toBe(false);
    expect(result.codeChanged).toBe(true);
  });

  it('marks an all-document diff docsOnly without claiming code changed', () => {
    const result = summarizeDiffFiles([{ filename: 'PRD.md' }, { filename: 'docs/runbook.mdx' }]);
    expect(result.docsOnly).toBe(true);
    expect(result.codeChanged).toBe(false);
  });
});
