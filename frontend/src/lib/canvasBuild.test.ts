import { describe, expect, it, vi } from 'vitest';
import { BUILD_RESOURCE_PREFIX, canvasBuildBinding, canvasBuildModality, canvasBuildPatch } from './canvasBuild';
import type { CreationNodeData } from '@/components/creation-canvas/types';
import type { IdeProject } from './types';

const ideProject: IdeProject = {
  id: 42,
  publicId: 'ide-pub',
  name: 'Marketing site',
  modality: 'designer',
  status: 'active',
  containerProjectId: 7,
  containerName: 'Launch',
  storageProjectId: 900,
  storageProjectPublicId: 'stor-pub',
  storageProjectKey: 'MS',
  workflowDefinitionId: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

function build(extra: Partial<CreationNodeData> = {}): CreationNodeData {
  return { kind: 'build', title: 'New build', ...extra };
}

describe('canvasBuildBinding', () => {
  it('is null until the workspace exists', () => {
    expect(canvasBuildBinding(build())).toBeNull();
    expect(canvasBuildBinding(build({ modality: 'mobile' }))).toBeNull();
  });

  it('resolves the bound workspace from the patch the create flow writes', () => {
    const bound = build(canvasBuildPatch(ideProject));
    expect(canvasBuildBinding(bound)).toEqual({
      ideProjectId: 42,
      storageProjectId: 900,
      storageProjectPublicId: 'stor-pub',
      modality: 'designer',
    });
  });

  // A snapshot round-trip can drop either half of the binding; each side alone is
  // enough to keep the object openable rather than silently offering to re-create.
  it('recovers the ide project id from resourceId alone', () => {
    const binding = canvasBuildBinding(build({ resourceId: `${BUILD_RESOURCE_PREFIX}42`, storageProjectId: 900 }));
    expect(binding?.ideProjectId).toBe(42);
    expect(binding?.storageProjectPublicId).toBe('900');
  });

  it('recovers the ide project id from the numeric mirror alone', () => {
    expect(canvasBuildBinding(build({ ideProjectId: 42, storageProjectId: 900 }))?.ideProjectId).toBe(42);
  });

  it('rejects a resourceId that points at something else', () => {
    expect(canvasBuildBinding(build({ resourceId: 'project:42', storageProjectId: 900 }))).toBeNull();
  });

  it('rejects non-positive and non-integer ids', () => {
    expect(canvasBuildBinding(build({ ideProjectId: 0, storageProjectId: 900 }))).toBeNull();
    expect(canvasBuildBinding(build({ ideProjectId: 42, storageProjectId: -1 }))).toBeNull();
    expect(canvasBuildBinding(build({ ideProjectId: 4.5, storageProjectId: 900 }))).toBeNull();
  });

  it('falls back to the default modality for an unknown stored value', () => {
    expect(canvasBuildBinding(build({ ideProjectId: 1, storageProjectId: 2, modality: 'nonsense' }))?.modality).toBe('designer');
  });

  it('resolves the retired combined llm modality to evermind', () => {
    expect(canvasBuildBinding(build({ ideProjectId: 1, storageProjectId: 2, modality: 'llm' }))?.modality).toBe('evermind');
  });
});

describe('canvasBuildPatch', () => {
  it('binds the created IDE project onto the object', () => {
    expect(canvasBuildPatch(ideProject)).toEqual({
      title: 'Marketing site',
      resourceId: 'ideProject:42',
      ideProjectId: 42,
      storageProjectId: 900,
      storageProjectPublicId: 'stor-pub',
      containerProjectId: 7,
      modality: 'designer',
      status: 'Workspace ready',
    });
  });
});

describe('canvasBuildModality', () => {
  it('always builds a website for a Website or prototype object', () => {
    expect(canvasBuildModality({ kind: 'website', title: 'Site', modality: 'video' })).toBe('designer');
    expect(canvasBuildModality({ kind: 'prototype', title: 'Proto' })).toBe('designer');
  });

  it('honours a Builder object’s own choice', () => {
    expect(canvasBuildModality(build({ modality: 'mobile' }))).toBe('mobile');
    expect(canvasBuildModality(build())).toBe('designer');
  });
});

describe('createCanvasBuild', () => {
  it('creates the IDE project that seeds the starter template', async () => {
    vi.resetModules();
    const createIdeProject = vi.fn().mockResolvedValue(ideProject);
    vi.doMock('@/lib/api', () => ({ createIdeProject }));
    const { createCanvasBuild } = await import('./canvasBuild');
    await createCanvasBuild({ title: '  Marketing site  ', modality: 'mobile', containerProjectId: 7 });
    expect(createIdeProject).toHaveBeenCalledWith({ name: 'Marketing site', modality: 'mobile', containerProjectId: 7 });
    vi.doUnmock('@/lib/api');
  });

  it('falls back to a usable name and no parent project', async () => {
    vi.resetModules();
    const createIdeProject = vi.fn().mockResolvedValue(ideProject);
    vi.doMock('@/lib/api', () => ({ createIdeProject }));
    const { createCanvasBuild } = await import('./canvasBuild');
    await createCanvasBuild({ title: '   ', modality: 'designer' });
    expect(createIdeProject).toHaveBeenCalledWith({ name: 'New build', modality: 'designer', containerProjectId: null });
    vi.doUnmock('@/lib/api');
  });
});
