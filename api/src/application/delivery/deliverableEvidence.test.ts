import { describe, expect, it } from 'vitest';
import { classifyDeliverablePaths, isDocumentationPath } from './deliverableEvidence';

describe('deliverable evidence', () => {
  it.each([
    'PRD.md', 'specs/tasks/task-615.md', 'docs/runbook.mdx', './README.rst', 'notes.txt',
  ])('recognizes documentation path %s', (path) => {
    expect(isDocumentationPath(path)).toBe(true);
  });

  it.each([
    'api/src/index.ts', 'frontend/src/App.tsx', 'api/migrations/0400_fix.sql',
    '.github/workflows/ci.yml', 'wrangler.toml',
  ])('recognizes implementation/configuration path %s', (path) => {
    expect(isDocumentationPath(path)).toBe(false);
  });

  it('classifies no paths, documentation-only paths, and mixed delivery', () => {
    expect(classifyDeliverablePaths([])).toBe('none');
    expect(classifyDeliverablePaths(['PRD.md', 'specs/tasks/task-1.md'])).toBe('docs_only');
    expect(classifyDeliverablePaths(['docs/plan.md', 'api/src/feature.ts'])).toBe('implementation');
  });
});
