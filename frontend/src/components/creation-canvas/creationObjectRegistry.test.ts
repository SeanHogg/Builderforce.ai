import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData, creationObjectDefinition } from './creationObjectRegistry';

describe('creation object registry', () => {
  it('has one unique definition for every palette object', () => {
    const kinds = CREATION_OBJECT_REGISTRY.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)))).toEqual(new Set(kinds));
  });

  it('produces valid default data and resolves the same canonical definition', () => {
    for (const definition of CREATION_OBJECT_REGISTRY) {
      const data = createDefaultCreationData(definition.kind);
      expect(data.kind).toBe(definition.kind);
      expect(data.title.trim()).not.toBe('');
      expect(creationObjectDefinition(definition.kind)).toBe(definition);
    }
  });
});
