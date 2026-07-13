import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from './ProjectService';
import { Project } from '../../domain/project/Project';
import { ProjectStatus, asTenantId } from '../../domain/shared/types';
import type { IProjectRepository } from '../../domain/project/IProjectRepository';
import type { ITaskRepository } from '../../domain/task/ITaskRepository';

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
