import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY } from './creationObjectRegistry';

describe('probe', () => {
  it('lists kinds without content', () => {
    const missing = CREATION_OBJECT_REGISTRY.filter((d) => !d.mutableFields.includes('content')).map((d) => d.kind);
    expect(missing).toEqual([]);
  });
});
