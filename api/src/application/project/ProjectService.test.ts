import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from './ProjectService';
import type { IProjectRepository } from '../../domain/project/IProjectRepository';

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
