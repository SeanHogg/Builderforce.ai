import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../infrastructure/database/connection';
import type { Env } from '../env';
import type { Project } from '../domain/project/Project';

vi.mock('../application/project/ideProjectBinding', () => ({
  ensureIdeProjectForStorage: vi.fn(),
}));
vi.mock('../application/project/provisionProject', () => ({
  provisionProject: vi.fn(),
}));
vi.mock('../application/observability/caughtErrorReporter', () => ({
  reportCaughtError: vi.fn(),
}));

import { ensureIdeProjectForStorage } from '../application/project/ideProjectBinding';
import { provisionProject } from '../application/project/provisionProject';
import { reportCaughtError } from '../application/observability/caughtErrorReporter';
import {
  afterBrainProjectCreate,
  ensureProjectCodingTarget,
  hasConnectedRepo,
  workspaceFilesPath,
} from './ensureProjectCodingTarget';

const bind = vi.mocked(ensureIdeProjectForStorage);
const provision = vi.mocked(provisionProject);
const report = vi.mocked(reportCaughtError);

const db = {} as Db;
const env = {} as Env;
const project = { id: 34, toPlain: () => ({ id: 34 }) } as unknown as Project;

describe('hasConnectedRepo', () => {
  it('is true when a source-control full name is set', () => {
    expect(hasConnectedRepo({ id: 1, sourceControlRepoFullName: 'acme/app' })).toBe(true);
  });
  it('is true when a github URL is set', () => {
    expect(hasConnectedRepo({ id: 1, githubRepoUrl: 'https://github.com/acme/app' })).toBe(true);
  });
  it('is false when neither is set', () => {
    expect(hasConnectedRepo({ id: 1 })).toBe(false);
    expect(hasConnectedRepo({ id: 1, sourceControlRepoFullName: null, githubRepoUrl: null })).toBe(false);
  });
});

describe('workspaceFilesPath', () => {
  it('matches the agent-host workspace files route coding-dispatch uses', () => {
    expect(workspaceFilesPath(12, 34)).toBe('/api/agent-hosts/12/workspace/34/files');
  });
});

describe('ensureProjectCodingTarget', () => {
  beforeEach(() => {
    bind.mockReset();
    provision.mockReset();
    report.mockReset();
  });

  it('returns repo and does not bind when source control is already connected', async () => {
    const result = await ensureProjectCodingTarget(db, 1, {
      id: 9,
      sourceControlRepoFullName: 'acme/app',
    });
    expect(result).toEqual({ kind: 'repo', repoFullName: 'acme/app' });
    expect(bind).not.toHaveBeenCalled();
  });

  it('treats a github URL as a connected repo (no IDE bind)', async () => {
    const result = await ensureProjectCodingTarget(db, 1, {
      id: 9,
      githubRepoUrl: 'https://github.com/acme/app',
    });
    expect(result).toEqual({ kind: 'repo', repoFullName: 'https://github.com/acme/app' });
    expect(bind).not.toHaveBeenCalled();
  });

  it('binds the IDE workspace for a Brain/designer project with no repo', async () => {
    bind.mockResolvedValue({ id: 7, created: true });
    const result = await ensureProjectCodingTarget(db, 1, { id: 34 });
    expect(bind).toHaveBeenCalledWith(db, 1, 34);
    expect(result).toEqual({
      kind: 'workspace',
      storageProjectId: 34,
      ideProjectId: 7,
      created: true,
    });
  });

  it('is idempotent — a second bind reports created: false', async () => {
    bind.mockResolvedValue({ id: 7, created: false });
    const result = await ensureProjectCodingTarget(db, 1, { id: 34 });
    expect(result).toEqual({
      kind: 'workspace',
      storageProjectId: 34,
      ideProjectId: 7,
      created: false,
    });
  });

  it('returns none when the project is not the tenant\'s', async () => {
    bind.mockResolvedValue(null);
    const result = await ensureProjectCodingTarget(db, 1, { id: 99 });
    expect(result).toEqual({
      kind: 'none',
      reason: 'project is not in tenant — cannot bind IDE workspace',
    });
  });

  it('runs the provision callback before binding, and still binds if provision throws', async () => {
    bind.mockResolvedValue({ id: 7, created: true });
    const boom = new Error('r2 down');
    const provisionFn = vi.fn(async () => {
      throw boom;
    });
    const result = await ensureProjectCodingTarget(db, 1, { id: 34 }, { provision: provisionFn });
    expect(provisionFn).toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({
      source: 'services/ensureProjectCodingTarget.ts',
      operation: 'provision',
    }));
    expect(result).toEqual({
      kind: 'workspace',
      storageProjectId: 34,
      ideProjectId: 7,
      created: true,
    });
  });
});

describe('afterBrainProjectCreate', () => {
  beforeEach(() => {
    bind.mockReset();
    provision.mockReset();
    report.mockReset();
  });

  it('provisions then binds the IDE workspace', async () => {
    provision.mockResolvedValue(undefined);
    bind.mockResolvedValue({ id: 12, created: true });
    const result = await afterBrainProjectCreate(env, db, 1, project);
    expect(provision).toHaveBeenCalledWith(env, db, 1, project);
    expect(bind).toHaveBeenCalledWith(db, 1, 34);
    expect(result).toEqual({
      kind: 'workspace',
      storageProjectId: 34,
      ideProjectId: 12,
      created: true,
    });
  });

  it('skips provision when a repo is already connected', async () => {
    const withRepo = {
      id: 34,
      sourceControlRepoFullName: 'acme/app',
      toPlain: () => ({ id: 34 }),
    } as unknown as Project;
    const result = await afterBrainProjectCreate(env, db, 1, withRepo);
    expect(provision).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'repo', repoFullName: 'acme/app' });
  });
});
