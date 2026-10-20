import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  SYNC_DESTINATION_REQUIRED,
  bindOnCreate,
  refuseUnboundSync,
} from './bindDestination.js';
import { UNBOUND_DESTINATION, type EntityDestination, type LocalEntityType } from './records.js';

const BOUND: EntityDestination = {
  kind: 'bound',
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
  repository: 'org/repo',
};

const CREATE_TYPES = ['project', 'ticket', 'chat', 'audit-run', 'execution'] as const satisfies readonly LocalEntityType[];

/**
 * Caller every later sync must follow: ask refuseUnboundSync, and do not
 * proceed when it returns an error.
 */
function laterSync(
  record: { destination?: EntityDestination | null },
  proceed: (record: { destination: EntityDestination }) => void,
): { proceeded: boolean; error: Error | null } {
  const error = refuseUnboundSync(record);
  if (error) return { proceeded: false, error };
  proceed(record as { destination: EntityDestination });
  return { proceeded: true, error: null };
}

describe('bindOnCreate', () => {
  it('stores UNBOUND_DESTINATION explicitly when the caller omits a destination', () => {
    const input = { id: 'ticket-1', entityType: 'ticket' as const, payload: { title: 'Offline' } };
    const record = bindOnCreate(input);
    expect(record).not.toBe(input);
    expect(input).not.toHaveProperty('destination');
    expect(Object.hasOwn(record, 'destination')).toBe(true);
    expect(record.destination).toBe(UNBOUND_DESTINATION);
    expect(record.destination).toEqual({ kind: 'unbound' });
    expect(JSON.parse(JSON.stringify(record)).destination).toEqual({ kind: 'unbound' });
    expect(record.id).toBe('ticket-1');
    expect(record.payload).toEqual({ title: 'Offline' });
  });

  it('stores UNBOUND_DESTINATION when destination is null, undefined, or not a destination', () => {
    expect(bindOnCreate({ id: 'a', destination: null }).destination).toBe(UNBOUND_DESTINATION);
    expect(bindOnCreate({ id: 'b', destination: undefined }).destination).toBe(UNBOUND_DESTINATION);
    expect(bindOnCreate({ id: 'c', destination: {} as EntityDestination }).destination).toBe(UNBOUND_DESTINATION);
    expect(bindOnCreate({ id: 'd', destination: 'unbound' as unknown as EntityDestination }).destination).toBe(
      UNBOUND_DESTINATION,
    );
  });

  it('uses the destination the caller passed, including an explicit unbound destination', () => {
    const bound = { ...BOUND };
    const created = bindOnCreate({ id: 'ticket-2', entityType: 'ticket' as const, destination: bound });
    expect(created.destination).toBe(bound);
    expect(created.destination).toEqual(BOUND);

    const explicit = bindOnCreate({ id: 'ticket-3', destination: UNBOUND_DESTINATION });
    expect(explicit.destination).toBe(UNBOUND_DESTINATION);
    expect(Object.hasOwn(explicit, 'destination')).toBe(true);
  });

  it('never omits destination for project, ticket, chat, audit, or run creation', () => {
    for (const entityType of CREATE_TYPES) {
      const omitted = bindOnCreate({ id: `${entityType}-1`, entityType, payload: { title: 'Offline' } });
      expect(Object.hasOwn(omitted, 'destination')).toBe(true);
      expect(omitted.destination).toBe(UNBOUND_DESTINATION);

      const passed = { kind: 'bound' as const, tenantId: 'tenant-a', projectId: 'project-a' };
      const bound = bindOnCreate({ id: `${entityType}-2`, entityType, destination: passed });
      expect(bound.destination).toBe(passed);
      expect(bound.entityType).toBe(entityType);
    }
  });
});

describe('refuseUnboundSync', () => {
  it('returns an error when destination is missing or unbound, and null when bound', () => {
    const missing = refuseUnboundSync({ id: 'ticket-1' });
    const unbound = refuseUnboundSync(bindOnCreate({ id: 'ticket-2', entityType: 'ticket' }));
    const explicit = refuseUnboundSync({ destination: UNBOUND_DESTINATION });
    const smuggled = refuseUnboundSync({
      destination: { kind: 'unbound', tenantId: 'future-tenant' } as EntityDestination,
    });
    const bound = refuseUnboundSync(bindOnCreate({ id: 'ticket-3', destination: BOUND }));

    for (const error of [missing, unbound, explicit, smuggled]) {
      expect(error).toBeInstanceOf(Error);
      expect(error?.code).toBe(SYNC_DESTINATION_REQUIRED);
      expect(error?.message).toMatch(/until a destination is chosen/);
    }
    expect(bound).toBeNull();
    expect(refuseUnboundSync(null)).toMatchObject({ code: SYNC_DESTINATION_REQUIRED });
    expect(refuseUnboundSync(undefined)).toMatchObject({ code: SYNC_DESTINATION_REQUIRED });
  });

  it('does not proceed with a later sync until a destination is chosen', () => {
    const proceed = vi.fn();
    const created = bindOnCreate({ id: 'ticket-1', entityType: 'ticket' as const, payload: { title: 'Offline' } });
    const refused = laterSync(created, proceed);
    expect(refused.proceeded).toBe(false);
    expect(refused.error?.code).toBe(SYNC_DESTINATION_REQUIRED);
    expect(proceed).not.toHaveBeenCalled();

    const stillUnbound = laterSync({ destination: { kind: 'unbound' } }, proceed);
    expect(stillUnbound.proceeded).toBe(false);
    expect(proceed).not.toHaveBeenCalled();

    const chosen = { ...created, destination: BOUND };
    const allowed = laterSync(chosen, proceed);
    expect(allowed).toEqual({ proceeded: true, error: null });
    expect(refuseUnboundSync(chosen)).toBeNull();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(chosen);
  });

  it('imports only records and does not reach a session, a store, or the network', () => {
    const source = readFileSync(fileURLToPath(new URL('./bindDestination.ts', import.meta.url)), 'utf8');
    expect(source).toContain("from './records.js'");
    expect(source).not.toContain("from './sync");
    expect(source).not.toContain("from './store");
    expect(source).not.toContain("from './destinationBinding");
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('getConfiguration');
    expect(source).not.toContain('selectedTenant');
    expect(source).not.toMatch(/clients\/vscode|api\/src|rebindDestination|runChangeSet/);
    expect(source).toContain('export function bindOnCreate');
    expect(source).toContain('export function refuseUnboundSync');
  });
});
