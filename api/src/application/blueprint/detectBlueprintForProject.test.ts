/**
 * The use case is wiring, so these pin the wiring: the misses come back as reasons
 * (never throws), the commit defaults to the default branch's head, and what gets
 * stored is detection over the files actually read at that commit.
 */

import { describe, expect, it } from 'vitest';
import type { AppBlueprint } from '@builderforce/creation-canvas-contract';
import { detectBlueprintForProject, type DetectBlueprintDeps } from './detectBlueprintForProject';

const DB = {} as never;
const ENV = { JWT_SECRET: 'secret' } as never;
const INPUT = { tenantId: 7, projectId: 3 };

function deps(over: Partial<DetectBlueprintDeps> = {}) {
  const stored: Array<{ projectId: number; sha: string; blueprint: AppBlueprint }> = [];
  const reads: string[] = [];
  const d: DetectBlueprintDeps = {
    resolveDefaultRepoForProject: async () => ({ repoId: 'r1', provider: 'github', owner: 'acme', repo: 'app', defaultBranch: 'trunk' }),
    resolveRepoCredential: async () => ({
      repo: { id: 'r1', provider: 'github', host: null, owner: 'acme', repo: 'app', defaultBranch: 'trunk', projectId: 3, segmentId: null },
      token: 'tok',
    }),
    resolveRepoRefSha: async (_coords, ref) => (ref === 'trunk' ? 'headsha' : null),
    readBlueprintSources: async (ctx) => {
      reads.push(ctx.ref);
      return new Map([['builderforce.json', '{"isMonorepo":true}']]);
    },
    storeBlueprint: async (_db, projectId, sha, blueprint) => { stored.push({ projectId, sha, blueprint }); },
    ...over,
  };
  return { d, stored, reads };
}

describe('detectBlueprintForProject', () => {
  it('detects at the default branch head and stores the result', async () => {
    const { d, stored, reads } = deps();
    const result = await detectBlueprintForProject(DB, ENV, INPUT, d);
    expect(result.ok).toBe(true);
    expect(reads).toEqual(['headsha']);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.sha).toBe('headsha');
    expect(stored[0]?.blueprint.isMonorepo).toBe(true);
  });

  it('uses the given commit instead of resolving the head', async () => {
    const { d, reads } = deps({ resolveRepoRefSha: async () => { throw new Error('should not be called'); } });
    const result = await detectBlueprintForProject(DB, ENV, { ...INPUT, commitSha: 'given' }, d);
    expect(result.ok).toBe(true);
    expect(reads).toEqual(['given']);
  });

  it('returns a reason for a project with no repo, and for a repo with no credential', async () => {
    const noRepo = await detectBlueprintForProject(DB, ENV, INPUT, deps({ resolveDefaultRepoForProject: async () => null }).d);
    expect(noRepo).toEqual({ ok: false, reason: 'the project has no linked repository' });
    const noCred = await detectBlueprintForProject(DB, ENV, INPUT, deps({
      resolveRepoCredential: async () => ({ error: 'Repository has no linked credential', status: 400 }),
    }).d);
    expect(noCred).toEqual({ ok: false, reason: 'Repository has no linked credential' });
  });

  it('returns a reason when the head commit cannot be resolved', async () => {
    const result = await detectBlueprintForProject(DB, ENV, INPUT, deps({ resolveRepoRefSha: async () => null }).d);
    expect(result).toEqual({ ok: false, reason: 'could not resolve the head commit of trunk' });
  });

  it('turns a thrown collaborator into a reason instead of throwing', async () => {
    const result = await detectBlueprintForProject(DB, ENV, INPUT, deps({
      storeBlueprint: async () => { throw new Error('db down'); },
    }).d);
    expect(result).toEqual({ ok: false, reason: 'db down' });
  });
});
