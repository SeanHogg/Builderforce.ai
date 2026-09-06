import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_KINDS, PEOPLE_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import './peopleObjects';
import { PEOPLE_LABELS, PEOPLE_NAMESPACE, PEOPLE_OBJECT_SPECS } from './peopleObjects';
import { isSpecObjectKind, specObjectNamespace } from './specObjects';

/**
 * The people vocabulary's own guarantees — the parity test its sibling
 * vocabularies (hiring, legal, academic, operations) already had.
 *
 * A kind the contract names and this module does not spec is an object the
 * canvas can store and never render; a label missing for a kind is a palette
 * entry with a raw key. Both are defects that look like a working feature.
 */
describe('people vocabulary', () => {
  it('declares one spec per contract kind, and no more', () => {
    expect(PEOPLE_OBJECT_SPECS.map((spec) => spec.kind).sort()).toEqual([...PEOPLE_OBJECT_KINDS].sort());
    expect(Object.keys(PEOPLE_LABELS).sort()).toEqual([...PEOPLE_OBJECT_KINDS].sort());
  });

  it('registers every people kind in the canvas contract and under its namespace', () => {
    for (const kind of PEOPLE_OBJECT_KINDS) {
      expect(CREATION_OBJECT_KINDS).toContain(kind);
      expect(isSpecObjectKind(kind), kind).toBe(true);
      expect(specObjectNamespace(kind)).toBe(PEOPLE_NAMESPACE);
    }
  });
});
