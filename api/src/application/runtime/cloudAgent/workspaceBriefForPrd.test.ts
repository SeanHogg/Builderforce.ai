import { describe, expect, it } from 'vitest';
import { workspaceBriefForPrd, type WorkspaceContext } from './prd';

const empty: WorkspaceContext = {
  repo: null,
  topLevel: [],
  fileCount: 0,
  truncated: false,
  priorChanges: [],
};

describe('workspaceBriefForPrd', () => {
  it('is empty when there is nothing to report', () => {
    expect(workspaceBriefForPrd(empty)).toBe('');
  });

  it('names the bound repo, tree, and prior branch changes', () => {
    const brief = workspaceBriefForPrd({
      repo: { owner: 'acme', repo: 'app', provider: 'github', base: 'main' },
      topLevel: ['src/', 'package.json'],
      fileCount: 12,
      truncated: true,
      priorChanges: [{ path: 'src/a.ts', status: 'M' }],
    });
    expect(brief).toContain('Bound repo: acme/app (github, base main).');
    expect(brief).toContain('Top-level: src/, package.json (truncated).');
    expect(brief).toContain('Tracked files: 12.');
    expect(brief).toContain('Prior branch changes: M src/a.ts.');
  });

  it('falls back to the IDE workspace when no git repo is bound', () => {
    const brief = workspaceBriefForPrd({
      ...empty,
      ide: { projectId: 11, projectName: 'Studio' },
    });
    expect(brief).toBe('IDE workspace: Studio (project 11).');
  });

  it('surfaces the unbound reason so the draft is not silently ungrounded', () => {
    expect(workspaceBriefForPrd({ ...empty, reason: 'unbound' })).toBe(
      'No coding target bound: unbound',
    );
  });
});
