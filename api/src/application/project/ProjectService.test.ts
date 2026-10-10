import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from './ProjectService';
import { Project } from '../../domain/project/Project';
import { ProjectStatus, asTenantId } from '../../domain/shared/types';
import type { IProjectRepository } from '../../domain/project/IProjectRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';
import { ConflictError } from '../../domain/shared/errors';

/** Minimal repo stub — only `findByKey` matters for buildUniqueKey. */
function repoWithTakenKeys(taken: string[]): IProjectRepository {
  const set = new Set(taken);
  return {
    findByKey: vi.fn(async (key: string) => (set.has(key) ? ({ id: 1 } as never) : null)),
  } as unknown as IProjectRepository;
}

describe('ProjectService.buildUniqueKey', () => {
  it('returns the base key when it is free', async () => {
    const svc = new ProjectService(repoWithTakenKeys([]));
    expect(await svc.buildUniqueKey(1, 'Acme App')).toBe('1-ACME-APP');
  });

  it('collapses an "Untitled <timestamp>" placeholder to the PROJECT fallback', async () => {
    const svc = new ProjectService(repoWithTakenKeys([]));
    expect(await svc.buildUniqueKey(1, 'Untitled 1773010025035')).toBe('1-PROJECT');
  });

  it('suffixes -2/-3 so two placeholder projects do not collide on the unique key', async () => {
    // The regression this guards: collapsing every "Untitled" project to
    // `1-PROJECT` would make the second one fail the globally-unique key.
    const svc1 = new ProjectService(repoWithTakenKeys(['1-PROJECT']));
    expect(await svc1.buildUniqueKey(1, 'Untitled 999')).toBe('1-PROJECT-2');

    const svc2 = new ProjectService(repoWithTakenKeys(['1-PROJECT', '1-PROJECT-2']));
    expect(await svc2.buildUniqueKey(1, 'Untitled 999')).toBe('1-PROJECT-3');
  });

  it('suffixes a normal name on collision too', async () => {
    const svc = new ProjectService(repoWithTakenKeys(['1-ACME-APP']));
    expect(await svc.buildUniqueKey(1, 'Acme App')).toBe('1-ACME-APP-2');
  });
});

describe('ProjectService.updateProject re-keying', () => {
  function projectWithKey(key: string): Project {
    const now = new Date();
    return Project.reconstitute({
      id: 7 as never,
      publicId: 'pub-7',
      tenantId: asTenantId(1),
      key,
      name: 'Acme App',
      description: null,
      template: null,
      rootWorkingDirectory: null,
      status: ProjectStatus.ACTIVE,
      sourceControlIntegrationId: null,
      sourceControlProvider: null,
      sourceControlRepoFullName: null,
      sourceControlRepoUrl: null,
      githubRepoUrl: null,
      githubRepoOwner: null,
      githubRepoName: null,
      governance: null,
      modality: 'designer',
      origin: null,
      initiativeId: null,
      companyId: null,
      dueDate: null,
      createdAt: now,
      updatedAt: now,
    } as never);
  }

  function harness(existingKey: string) {
    const project = projectWithKey(existingKey);
    const projects = {
      findById: vi.fn(async () => project),
      findByKey: vi.fn(async () => null),
      update: vi.fn(async (p: Project) => p),
    } as unknown as IProjectRepository;
    const tasks = { rekeyProject: vi.fn(async () => 3) } as unknown as ITaskRepository;
    return { svc: new ProjectService(projects, tasks), tasks, project };
  }

  it('re-keys existing tasks onto the new project key when the key changes', async () => {
    const { svc, tasks } = harness('1-ACME-APP');
    const updated = await svc.updateProject(7, { key: 'ACME-V2' }, 1);
    expect(updated.key).toBe('ACME-V2');
    expect(tasks.rekeyProject).toHaveBeenCalledWith(7, 'ACME-V2');
  });

  it('does NOT re-key when the key is unchanged (only name edited)', async () => {
    const { svc, tasks } = harness('1-ACME-APP');
    await svc.updateProject(7, { name: 'Acme App Renamed' }, 1);
    expect(tasks.rekeyProject).not.toHaveBeenCalled();
  });

  it('treats a same-key edit (case/whitespace only) as no change', async () => {
    const { svc, tasks } = harness('1-ACME-APP');
    await svc.updateProject(7, { key: '  1-acme-app  ' }, 1);
    expect(tasks.rekeyProject).not.toHaveBeenCalled();
  });
});

describe('ProjectService create — projects_key_key collisions', () => {
  const keyViolation = () =>
    Object.assign(new Error('duplicate key value violates unique constraint "projects_key_key"'), { code: '23505' });

  /** Repo whose `save` fails with the key violation for every key in `raceLost`. */
  function racingRepo(opts: { taken?: string[]; raceLost?: string[]; otherError?: Error }) {
    const taken = new Set(opts.taken ?? []);
    const raceLost = new Set(opts.raceLost ?? []);
    const saved: string[] = [];
    const repo = {
      findByKey: vi.fn(async (key: string) => (taken.has(key.toUpperCase()) ? ({ id: 1 } as never) : null)),
      save: vi.fn(async (p: Project) => {
        if (opts.otherError) throw opts.otherError;
        if (raceLost.has(p.key)) {
          // A concurrent create won this key — it now exists for later lookups.
          taken.add(p.key);
          throw keyViolation();
        }
        saved.push(p.key);
        return p;
      }),
    } as unknown as IProjectRepository;
    return { repo, saved };
  }

  it('createProjectWithGeneratedKey re-derives and retries when a concurrent create wins the key', async () => {
    const { repo, saved } = racingRepo({ raceLost: ['1-ACME-APP'] });
    const project = await new ProjectService(repo).createProjectWithGeneratedKey({ tenantId: 1, name: 'Acme App' });
    expect(project.key).toBe('1-ACME-APP-2');
    expect(saved).toEqual(['1-ACME-APP-2']);
  });

  it('createProjectWithGeneratedKey gives up with a ConflictError after bounded attempts', async () => {
    const lost = ['1-ACME-APP', '1-ACME-APP-2', '1-ACME-APP-3', '1-ACME-APP-4', '1-ACME-APP-5', '1-ACME-APP-6'];
    const { repo } = racingRepo({ raceLost: lost });
    await expect(new ProjectService(repo).createProjectWithGeneratedKey({ tenantId: 1, name: 'Acme App' }))
      .rejects.toBeInstanceOf(ConflictError);
    expect((repo.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(5);
  });

  it('createProjectWithGeneratedKey rethrows a unique violation on a DIFFERENT constraint', async () => {
    const other = Object.assign(new Error('duplicate key value violates unique constraint "projects_public_id_key"'), { code: '23505' });
    const { repo } = racingRepo({ otherError: other });
    await expect(new ProjectService(repo).createProjectWithGeneratedKey({ tenantId: 1, name: 'Acme App' }))
      .rejects.toBe(other);
    expect((repo.save as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('createProject answers ConflictError for an explicit key that is already taken', async () => {
    const { repo } = racingRepo({ taken: ['MYKEY'] });
    await expect(new ProjectService(repo).createProject({ tenantId: 1, key: 'mykey', name: 'X' }))
      .rejects.toThrow(/Project key 'MYKEY' is already taken/);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('createProject maps a lost insert race on an explicit key to ConflictError, not a 500', async () => {
    const { repo } = racingRepo({ raceLost: ['MYKEY'] });
    await expect(new ProjectService(repo).createProject({ tenantId: 1, key: 'MyKey', name: 'X' }))
      .rejects.toBeInstanceOf(ConflictError);
  });
});
