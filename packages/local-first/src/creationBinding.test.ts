import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CREATION_ENTITY_TYPES,
  DESTINATION_FORGED,
  DESTINATION_REQUIRED,
  guardCreationBinding,
} from './creationBinding.js';
import { UNBOUND_DESTINATION, type EntityDestination } from './records.js';

const BOUND: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
  repository: 'org/repo',
};

describe('creation binding', () => {
  it('signed-out creation is unbound', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      for (const entityType of CREATION_ENTITY_TYPES) {
        const omitted = guardCreationBinding({ entityType, accountKnown: false });
        const explicit = guardCreationBinding({
          entityType,
          accountKnown: false,
          destination: { kind: 'unbound' },
        });
        const empty = guardCreationBinding({ entityType, accountKnown: false, destination: {} });
        const blank = guardCreationBinding({
          entityType,
          accountKnown: false,
          destination: { kind: 'bound', tenantId: '   ', projectId: '' },
        });
        expect(omitted).toEqual({ ok: true, destination: UNBOUND_DESTINATION });
        expect(explicit).toEqual({ ok: true, destination: UNBOUND_DESTINATION });
        expect(empty).toEqual({ ok: true, destination: UNBOUND_DESTINATION });
        expect(blank).toEqual({ ok: true, destination: UNBOUND_DESTINATION });
        if (omitted.ok) expect(omitted.destination).toBe(UNBOUND_DESTINATION);
        if (explicit.ok) expect(explicit.destination).toBe(UNBOUND_DESTINATION);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('signed-out creation with a forged tenant is rejected', () => {
    const forged = {
      kind: 'bound' as const,
      tenantId: 'future-tenant',
      projectId: 'future-project',
      accountId: 'whoever-signs-in-next',
    };
    for (const entityType of CREATION_ENTITY_TYPES) {
      const bound = guardCreationBinding({ entityType, accountKnown: false, destination: forged });
      const bare = guardCreationBinding({
        entityType,
        accountKnown: false,
        destination: { tenantId: 'future-tenant' },
      });
      const smuggled = guardCreationBinding({
        entityType,
        accountKnown: false,
        destination: { kind: 'unbound', tenantId: 'future-tenant', accountId: 'hidden' },
      });
      expect(bound).toEqual({ ok: false, reason: DESTINATION_FORGED });
      expect(bare).toEqual({ ok: false, reason: DESTINATION_FORGED });
      expect(smuggled).toEqual({ ok: false, reason: DESTINATION_FORGED });
    }
    expect(forged.tenantId).toBe('future-tenant');
  });

  it('signed-in creation without a destination is rejected', () => {
    for (const entityType of CREATION_ENTITY_TYPES) {
      expect(guardCreationBinding({ entityType, accountKnown: true })).toEqual({
        ok: false,
        reason: DESTINATION_REQUIRED,
      });
      expect(guardCreationBinding({ entityType, accountKnown: true, destination: null })).toEqual({
        ok: false,
        reason: DESTINATION_REQUIRED,
      });
      expect(guardCreationBinding({ entityType, accountKnown: true, destination: { kind: 'unbound' } })).toEqual({
        ok: false,
        reason: DESTINATION_REQUIRED,
      });
      expect(guardCreationBinding({ entityType, accountKnown: true, destination: {} })).toEqual({
        ok: false,
        reason: DESTINATION_REQUIRED,
      });
      expect(
        guardCreationBinding({
          entityType,
          accountKnown: true,
          destination: { kind: 'bound', tenantId: '  ', projectId: '' },
        }),
      ).toEqual({ ok: false, reason: DESTINATION_REQUIRED });
      expect(
        guardCreationBinding({
          entityType,
          accountKnown: true,
          destination: { kind: 'unbound', tenantId: 'smuggled' },
        }),
      ).toEqual({ ok: false, reason: DESTINATION_REQUIRED });
    }
  });

  it('signed-in creation with a bound destination is accepted', () => {
    const caller = { ...BOUND };
    for (const entityType of CREATION_ENTITY_TYPES) {
      const result = guardCreationBinding({ entityType, accountKnown: true, destination: caller });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.destination).toEqual(BOUND);
      expect(result.destination).not.toBe(caller);
      expect(Object.isFrozen(result.destination)).toBe(true);
      expect(result.destination.kind).toBe('bound');
    }
    caller.tenantId = 'hijacked';
    const after = guardCreationBinding({ entityType: 'ticket', accountKnown: true, destination: BOUND });
    expect(after).toEqual({ ok: true, destination: BOUND });

    const partial = guardCreationBinding({
      entityType: 'project',
      accountKnown: true,
      destination: { tenantId: '  tenant-a  ', projectId: 'project-a' },
    });
    expect(partial).toEqual({
      ok: true,
      destination: { kind: 'bound', tenantId: 'tenant-a', projectId: 'project-a' },
    });
    if (partial.ok) expect(Object.isFrozen(partial.destination)).toBe(true);
  });

  it('does not read a session, a store, or the network', () => {
    const source = readFileSync(fileURLToPath(new URL('./creationBinding.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain("from './store");
    expect(source).not.toContain("from './destinationBinding");
    expect(source).not.toContain("from './sync");
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('getConfiguration');
    expect(source).not.toContain('selectedTenant');
    expect(source).toContain("from './records.js'");
  });
});
