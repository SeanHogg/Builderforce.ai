import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, availableCreationObjects, createDefaultCreationData, creationObjectDefinition } from './creationObjectRegistry';
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
});
