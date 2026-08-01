import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, availableCreationObjects, createDefaultCreationData, creationObjectAiContext, creationObjectDefinition } from './creationObjectRegistry';
import { CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';

describe('creation object registry', () => {
  it('has one unique definition for every palette object', () => {
    const kinds = CREATION_OBJECT_REGISTRY.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)))).toEqual(new Set(kinds));
    expect(new Set(kinds)).toEqual(new Set(CREATION_OBJECT_KINDS));
  });

  it('produces valid default data and resolves the same canonical definition', () => {
    for (const definition of CREATION_OBJECT_REGISTRY) {
      const data = createDefaultCreationData(definition.kind);
      expect(data.kind).toBe(definition.kind);
      expect(data.title.trim()).not.toBe('');
      expect(creationObjectDefinition(definition.kind)).toBe(definition);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.allowedConnections.length).toBe(6);
      expect(definition.contextAdapter({ ...data, secret: 'must-not-leak' })).not.toHaveProperty('secret');
      expect(definition.previewAdapter(data)).toMatchObject({ kind: definition.kind, title: data.title });
    }
  });

  it('gates plan capabilities without hiding unrestricted object kinds', () => {
    const base = availableCreationObjects(new Set()).map((definition) => definition.kind);
    expect(base).toContain('workflow');
    expect(base).not.toContain('evermind');
    expect(availableCreationObjects(new Set(['evermind'])).map((definition) => definition.kind)).toContain('evermind');
  });

  it('retains structured evidence while excluding rows, prompts, and secrets from Brain context', () => {
    const context = creationObjectAiContext({
      kind: 'projectComparison', title: 'Alpha vs Beta', status: 'Live evidence', fetchedAt: '2026-08-01T00:00:00.000Z',
      projects: [{ name: 'Alpha', health: 91, features: ['Canvas'] }],
      sources: [{ label: 'Project metrics', resource: '/api/projects' }],
      columns: ['customer', 'request'], rowCount: 12_000,
      rows: [{ customer: 'private customer', request: 'secret request' }],
      prompt: 'private prompt', secret: 'sk-do-not-send', accessToken: 'token-do-not-send',
    });

    expect(context).toMatchObject({ title: 'Alpha vs Beta', rowCount: 12_000, columns: ['customer', 'request'] });
    expect(context.projects).toEqual([{ name: 'Alpha', health: 91, features: ['Canvas'] }]);
    expect(context.sources).toEqual([{ label: 'Project metrics', resource: '/api/projects' }]);
    expect(context).not.toHaveProperty('rows');
    expect(context).not.toHaveProperty('prompt');
    expect(context).not.toHaveProperty('secret');
    expect(context).not.toHaveProperty('accessToken');
  });
});
