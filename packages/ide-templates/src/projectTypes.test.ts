import { describe, expect, it } from 'vitest';
import { PROJECT_TYPES, projectTypeById, projectTypePath, type ProjectTypeAction } from './projectTypes';

const KINDS = new Set(['command', 'openWeb', 'pickModel', 'choice']);

function walk(actions: readonly ProjectTypeAction[]): ProjectTypeAction[] {
  return actions.flatMap((a) => (a.kind === 'choice' ? [a, ...walk(a.options)] : [a]));
}

describe('PROJECT_TYPES', () => {
  it('has the AI, Roblox and movie types with unique ids', () => {
    const ids = PROJECT_TYPES.map((t) => t.id);
    expect(ids).toEqual(['roblox', 'movie', 'ai-scratch', 'ai-existing', 'ai-knowledge-pack']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses modalities the API accepts and unique, non-empty keys', () => {
    const keys = PROJECT_TYPES.flatMap((t) => [t.labelKey, t.descriptionKey]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of PROJECT_TYPES) {
      expect(['evermind', 'finetune', 'roblox', 'video']).toContain(t.modality);
      expect(t.labelKey).toBeTruthy();
      expect(t.firstRun.length).toBeGreaterThan(0);
    }
  });

  it('only declares valid action kinds, with their required fields', () => {
    for (const action of PROJECT_TYPES.flatMap((t) => walk(t.firstRun))) {
      expect(KINDS.has(action.kind)).toBe(true);
      if (action.kind === 'command') expect(action.command).toMatch(/^(builderforce|spawn)\./);
      if (action.kind === 'openWeb') expect(action.path.startsWith('/')).toBe(true);
      if (action.kind === 'choice') {
        expect(action.options.length).toBeGreaterThan(1);
        for (const o of action.options) expect(o.kind === 'command' && o.labelKey).toBeTruthy();
      }
    }
  });

  it('maps each type to its modality and first run', () => {
    expect(projectTypeById('ai-scratch')?.modality).toBe('evermind');
    const existing = projectTypeById('ai-existing');
    expect(existing?.modality).toBe('finetune');
    expect(existing?.firstRun.map((a) => a.kind)).toEqual(['pickModel', 'openWeb']);
    expect(projectTypeById('ai-knowledge-pack')?.firstRun[0]?.kind).toBe('choice');
    expect(projectTypeById('nope')).toBeUndefined();
  });
});

describe('projectTypePath', () => {
  it('fills {projectId}', () => {
    expect(projectTypePath('/studio/project/{projectId}', 42)).toBe('/studio/project/42');
  });
});
