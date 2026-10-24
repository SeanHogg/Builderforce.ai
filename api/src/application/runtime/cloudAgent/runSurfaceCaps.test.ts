/** C5 on the durable surface: the run's capability set and its `repo.semantic` backing. */
import { describe, expect, it } from 'vitest';
import { durableRepoSemantic, durableRunCaps, prepSurfaceCaps } from './runSurfaceCaps';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';

const C5 = { COST_LEVERS_ALL: 'off', COST_LEVER_C5_CLOUD_REPO_MAP: 'on' };
const OFF = { COST_LEVERS_ALL: 'off' };
const repo: TicketRepoContext = {
  provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'bf/1', base: 'main', repoId: 'rid', segmentId: null, projectId: 4,
};
const owner = { parent: {}, runtime: {} } as never;

describe('durableRunCaps', () => {
  it('holds `shell` only when the run has a sandbox', () => {
    expect(durableRunCaps(C5, 1, owner, repo, true).has('shell')).toBe(true);
    expect(durableRunCaps(C5, 1, owner, repo).has('shell')).toBe(false);
  });

  it('adds repo.semantic only while C5 is on AND a repository backs it', () => {
    expect(durableRunCaps(C5, 1, owner, repo).has('repo.semantic')).toBe(true);
    expect(durableRunCaps(C5, 1, owner, null).has('repo.semantic')).toBe(false);
    expect(durableRunCaps(OFF, 1, owner, repo).has('repo.semantic')).toBe(false);
  });

  it('still withholds the delegation verbs from a run with no place in a tree', () => {
    expect(durableRunCaps(C5, 1, undefined, repo).has('orchestrate')).toBe(false);
    expect(durableRunCaps(C5, 1, owner, repo).has('orchestrate')).toBe(true);
  });
});

describe('prepSurfaceCaps', () => {
  it("is the one cloud set, plus the sandbox's `shell` for a sandboxed run, levers applied", () => {
    expect(prepSurfaceCaps(C5, 1, true).has('shell')).toBe(true);
    expect(prepSurfaceCaps(C5, 1, false).has('shell')).toBe(false);
    expect(prepSurfaceCaps(C5, 1, false).has('repo.semantic')).toBe(true);
    // A sandbox ADDS — the provider-backed tools a container image once lacked remain.
    for (const cap of ['repo.search', 'repo.delete', 'static-check', 'web'] as const) {
      expect(prepSurfaceCaps(C5, 1, true).has(cap)).toBe(true);
    }
  });
});

describe('durableRepoSemantic', () => {
  it('backs the capability only when the run holds it and has a repository', () => {
    const env = {} as never;
    expect(durableRepoSemantic(durableRunCaps(C5, 1, owner, repo), { env, tenantId: 1, projectId: 4, repoCtx: repo })).toBeDefined();
    expect(durableRepoSemantic(durableRunCaps(OFF, 1, owner, repo), { env, tenantId: 1, projectId: 4, repoCtx: repo })).toBeUndefined();
    expect(durableRepoSemantic(durableRunCaps(C5, 1, owner, repo), { env, tenantId: 1, projectId: 4, repoCtx: null })).toBeUndefined();
  });
});
