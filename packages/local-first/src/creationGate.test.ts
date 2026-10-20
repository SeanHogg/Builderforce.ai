import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { CREATION_KINDS, UNBOUND_DESTINATION, UNKNOWN_KIND, createBound } from './creationGate.js';
import { destinationKey } from './records.js';

const BOUND = {
  kind: 'bound' as const,
  destinationKey: 'https%3A%2F%2Fbuilderforce.example:account-a:tenant-a:project-a:org%2Frepo',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
  repository: 'org/repo',
};

function refusal(run: () => unknown): { code?: string } | undefined {
  try {
    run();
  } catch (error) {
    return error as { code?: string };
  }
  return undefined;
}

describe('creation gate', () => {
  it('returns the kind and destination key for a bound destination', () => {
    for (const kind of CREATION_KINDS) {
      const created = createBound(kind, BOUND);
      expect(created).toEqual({ kind, destinationKey: BOUND.destinationKey });
      expect(Object.isFrozen(created)).toBe(true);
    }
    expect(createBound('ticket', { destinationKey: 'tenant-a:project-a' })).toEqual({
      kind: 'ticket',
      destinationKey: 'tenant-a:project-a',
    });
    expect(createBound('project', { kind: 'bound', tenantId: 'tenant-a', projectId: 'project-a' })).toEqual({
      kind: 'project',
      destinationKey: destinationKey({ kind: 'bound', tenantId: 'tenant-a', projectId: 'project-a' }),
    });
    expect(createBound('run', 'tenant-a:project-a')).toEqual({
      kind: 'run',
      destinationKey: 'tenant-a:project-a',
    });
    expect(createBound('audit', { kind: 'bound', destinationKey: '  tenant-a  ' })).toEqual({
      kind: 'audit',
      destinationKey: 'tenant-a',
    });
  });

  it('refuses an unbound destination, a missing destination, and an empty destinationKey', () => {
    for (const kind of CREATION_KINDS) {
      expect(refusal(() => createBound(kind, { kind: 'unbound' }))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { kind: 'unbound', destinationKey: 'smuggled' }))?.code).toBe(
        UNBOUND_DESTINATION,
      );
      expect(refusal(() => createBound(kind, { kind: 'unbound', tenantId: 'future-tenant' }))?.code).toBe(
        UNBOUND_DESTINATION,
      );
      expect(refusal(() => createBound(kind, undefined))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, null))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { destinationKey: '' }))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { destinationKey: '   ' }))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { kind: 'bound', destinationKey: '' }))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { kind: 'bound' }))?.code).toBe(UNBOUND_DESTINATION);
      expect(
        refusal(() => createBound(kind, { kind: 'bound', tenantId: '  ', projectId: '' }))?.code,
      ).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, ''))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, '   '))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, 'unbound'))?.code).toBe(UNBOUND_DESTINATION);
      expect(refusal(() => createBound(kind, { kind: 'bound', destinationKey: 'unbound' }))?.code).toBe(
        UNBOUND_DESTINATION,
      );
    }
  });

  it('refuses an unknown kind and writes nothing', () => {
    const destination = {
      kind: 'bound' as const,
      destinationKey: 'kept',
      write: vi.fn(),
    };
    for (const kind of ['execution', 'audit-run', 'message', '', 'Project', 'AUDIT']) {
      expect(refusal(() => createBound(kind, destination))?.code).toBe(UNKNOWN_KIND);
    }
    expect(destination.write).not.toHaveBeenCalled();
    expect(destination.destinationKey).toBe('kept');
    expect(destination).not.toHaveProperty('created');
  });

  it('takes the destination value and never calls a lookup function', () => {
    const lookup = vi.fn(() => ({ kind: 'bound', destinationKey: 'from-lookup' }));
    expect(refusal(() => createBound('chat', lookup))?.code).toBe(UNBOUND_DESTINATION);
    expect(lookup).not.toHaveBeenCalled();

    const nested = vi.fn(() => 'from-nested-lookup');
    expect(refusal(() => createBound('ticket', { lookup: nested }))?.code).toBe(UNBOUND_DESTINATION);
    expect(nested).not.toHaveBeenCalled();

    expect(refusal(() => createBound('not-a-kind', lookup))?.code).toBe(UNKNOWN_KIND);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not read a session, a store, or the network, and does not write', () => {
    const source = readFileSync(fileURLToPath(new URL('./creationGate.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain("from './store");
    expect(source).not.toContain("from './destinationBinding");
    expect(source).not.toContain("from './sync");
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('getConfiguration');
    expect(source).not.toContain('selectedTenant');
    expect(source).not.toContain('writeFile');
    expect(source).not.toContain('.set(');
    expect(source).toContain("from './records.js'");
    expect(source).toContain('unbound_destination');
    expect(source).toContain('unknown_kind');
  });
});
