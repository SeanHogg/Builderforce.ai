import { describe, expect, it } from 'vitest';
import { CREATION_COMMAND_TYPES, CREATION_CONNECTION_KINDS, CREATION_OBJECT_KINDS, isCreationCommandType, isCreationConnectionKind, isCreationObjectKind } from '@builderforce/creation-canvas-contract';

describe('Creation Canvas shared contract', () => {
  it('exposes every web object kind to the VSIX', () => {
    expect(CREATION_OBJECT_KINDS).toContain('workflow');
    expect(CREATION_OBJECT_KINDS).toContain('website');
    expect(CREATION_OBJECT_KINDS).toContain('evermind');
    expect(CREATION_OBJECT_KINDS).toContain('voice');
    expect(CREATION_OBJECT_KINDS).toEqual(expect.arrayContaining(['repository', 'selection', 'diagnostics', 'terminal', 'service']));
    expect(new Set(CREATION_OBJECT_KINDS).size).toBe(CREATION_OBJECT_KINDS.length);
  });

  it('rejects kinds and commands outside the canonical transport contract', () => {
    expect(isCreationObjectKind('dataset')).toBe(true);
    expect(isCreationObjectKind('untrusted-object')).toBe(false);
    expect(CREATION_COMMAND_TYPES.every(isCreationCommandType)).toBe(true);
    expect(isCreationCommandType('resource.secret.write')).toBe(false);
    expect(CREATION_CONNECTION_KINDS.every(isCreationConnectionKind)).toBe(true);
    expect(isCreationConnectionKind('smoothstep')).toBe(false);
  });
});
