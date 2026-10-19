import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  assignDestination,
  bindLocalRecord,
  createBoundRecord,
  createDestinationBoundRecord,
  bindingSnapshot,
  destinationRebindCode,
  DESTINATION_CREATION_KINDS,
  UNBOUND_DESTINATION_CODE,
  type DestinationBindingCode,
  type DestinationCreationKind,
} from './destinationBinding.js';
import { UNBOUND_DESTINATION, destinationKey, type EntityDestination, type LocalEntityType } from './records.js';

const AT = '2026-10-19T00:00:00.000Z';
const OWNED = {
  platformInstance: 'https://builderforce.example',
  accountId: 'account-a',
  tenantId: 'tenant-a',
  projectId: 'project-a',
  repository: 'org/repo',
};

const created = (entityType: LocalEntityType = 'ticket', destination?: EntityDestination | Record<string, unknown>) =>
  createBoundRecord({
    id: `${entityType}-1`,
    entityType,
    payload: { title: 'Offline' },
    deviceId: 'device-a',
    occurredAt: AT,
    schemaVersion: 1,
    ...(destination ? { destination: destination as EntityDestination } : {}),
  });

/**
 * A create input whose destination is supplied by the caller, so a proposal
 * can be aimed at the same neutral record each time.
 */
const NEUTRAL_CREATE = {
  id: 'ticket-neutral',
  entityType: 'ticket' as LocalEntityType,
  payload: { title: 'Offline' },
  deviceId: 'device-a',
  occurredAt: AT,
  schemaVersion: 1,
};

const KIND_ENTITY: Record<DestinationCreationKind, LocalEntityType> = {
  project: 'project',
  ticket: 'ticket',
  chat: 'chat',
  audit: 'audit-run',
  run: 'execution',
};

function refusal(run: () => unknown): { code?: string; entityType?: string } | undefined {
  try {
    run();
  } catch (error) {
    return error as { code?: string; entityType?: string };
  }
  return undefined;
}

describe('destination binding', () => {
  it('stamps a frozen snapshot onto a new record and does not keep the caller object', () => {
    const binding = { ...OWNED };
    const record = created('ticket', binding);
    expect(record.destination).toEqual({ kind: 'bound', ...OWNED });
    expect(record.destination).not.toBe(binding);
    expect(Object.isFrozen(record.destination)).toBe(true);
    expect(record.version).toBe(1);
    expect(record.occurredAt).toBe(AT);
    expect(record.provenance).toEqual({ deviceId: 'device-a', source: 'local' });
    binding.tenantId = 'hijacked';
    expect(record.destination).toMatchObject({ tenantId: 'tenant-a', accountId: 'account-a' });
  });

  it('binds project, ticket, chat, audit, and run records at creation when identity is known', () => {
    const types = ['project', 'ticket', 'chat', 'audit-run', 'execution'] as const;
    for (const entityType of types) {
      const record = created(entityType, OWNED);
      expect(record.entityType).toBe(entityType);
      expect(record.destination).toMatchObject({ kind: 'bound', accountId: 'account-a', tenantId: 'tenant-a' });
    }
  });

  it('keeps a non-creation record in the unbound partition and still snapshots a known field', () => {
    const message = createBoundRecord({
      id: 'message-1',
      entityType: 'message',
      payload: { title: 'Offline' },
      deviceId: 'device-a',
      occurredAt: AT,
      destination: { kind: 'unbound', tenantId: 'hidden', accountId: 'hidden' },
    });
    expect(message.destination).toBe(UNBOUND_DESTINATION);
    expect(bindingSnapshot(undefined)).toBe(UNBOUND_DESTINATION);
    expect(bindingSnapshot({ tenantId: 12 as unknown as string, accountId: 'ok' })).toEqual({
      kind: 'bound',
      accountId: 'ok',
    });
  });

  it('accepts a bound destination for project, ticket, chat, audit, and run and stores a snapshot', () => {
    for (const kind of DESTINATION_CREATION_KINDS) {
      const binding = { ...OWNED };
      const record = createDestinationBoundRecord(kind, {
        id: `${kind}-bound`,
        payload: { title: 'Offline' },
        deviceId: 'device-a',
        occurredAt: AT,
        schemaVersion: 1,
        destination: binding,
      });
      expect(record.entityType).toBe(KIND_ENTITY[kind]);
      expect(record.destination).toEqual({ kind: 'bound', ...OWNED });
      expect(record.destination).not.toBe(binding);
      expect(Object.isFrozen(record.destination)).toBe(true);
      binding.tenantId = 'hijacked';
      expect(record.destination).toMatchObject({ tenantId: 'tenant-a', accountId: 'account-a' });

      const viaType = createBoundRecord({
        id: `${KIND_ENTITY[kind]}-direct`,
        entityType: KIND_ENTITY[kind],
        payload: { title: 'Offline' },
        deviceId: 'device-a',
        occurredAt: AT,
        destination: { ...OWNED, destinationKey: 'kept' } as EntityDestination,
      });
      expect(viaType.entityType).toBe(KIND_ENTITY[kind]);
      expect(viaType.destination).toEqual({ kind: 'bound', ...OWNED });
      expect(viaType.destination).not.toHaveProperty('destinationKey');
    }
  });

  it('rejects an unbound destination for each creation kind and writes nothing', () => {
    const written: unknown[] = [];
    const unboundCases = [
      undefined,
      null,
      UNBOUND_DESTINATION,
      { kind: 'unbound', tenantId: 'future-tenant', accountId: 'future-account' },
      { kind: 'bound' },
      { kind: 'bound', destinationKey: '' },
      { kind: 'bound', destinationKey: '   ' },
      { kind: 'bound', destinationKey: 'unbound', tenantId: 'smuggled' },
      { kind: 'bound', destinationKey: '', tenantId: 'tenant-a' },
      { accountId: '   ', tenantId: '' },
      { destinationKey: '' },
      { destinationKey: 'unbound' },
      '',
      '   ',
      'unbound',
    ];
    for (const kind of DESTINATION_CREATION_KINDS) {
      for (const destination of unboundCases) {
        let record: unknown;
        const error = refusal(() => {
          record = createDestinationBoundRecord(kind, {
            id: `${kind}-unbound`,
            payload: { title: 'Offline' },
            deviceId: 'device-a',
            occurredAt: AT,
            destination: destination as EntityDestination,
          });
          written.push(record);
        });
        expect(record).toBeUndefined();
        expect(error?.code).toBe(UNBOUND_DESTINATION_CODE);
        expect(error?.entityType).toBe(KIND_ENTITY[kind]);
      }
      const typeError = refusal(() => {
        const record = createBoundRecord({
          id: `${kind}-type`,
          entityType: KIND_ENTITY[kind],
          payload: { title: 'Offline' },
          deviceId: 'device-a',
          destination: UNBOUND_DESTINATION,
        });
        written.push(record);
      });
      expect(typeError?.code).toBe(UNBOUND_DESTINATION_CODE);
      expect(typeError?.entityType).toBe(KIND_ENTITY[kind]);
    }
    expect(written).toEqual([]);
    expect(DESTINATION_CREATION_KINDS).toEqual(['project', 'ticket', 'chat', 'audit', 'run']);
  });

  it('snapshots project, platform, and repository where known and will not fill a tenant later', () => {
    const projectOnly = created('project', { projectId: '  project-a  ' });
    expect(projectOnly.destination).toEqual({ kind: 'bound', projectId: 'project-a' });
    expect(Object.isFrozen(projectOnly.destination)).toBe(true);
    const scoped = created('chat', { platformInstance: 'https://builderforce.example', repository: 'org/repo' });
    expect(scoped.destination).toEqual({
      kind: 'bound',
      platformInstance: 'https://builderforce.example',
      repository: 'org/repo',
    });
    expect(() => assignDestination(projectOnly, { projectId: 'project-a', tenantId: 'tenant-b', accountId: 'account-b' })).toThrow(
      'destination_tenant_mismatch',
    );
    expect(projectOnly.destination).toEqual({ kind: 'bound', projectId: 'project-a' });
  });

  it('does not adopt a future tenant unless assignDestination is called', () => {
    const unbound = createBoundRecord({
      id: 'message-1',
      entityType: 'message',
      payload: { title: 'Offline' },
      deviceId: 'device-a',
      occurredAt: AT,
    });
    const nextUser = { accountId: 'account-b', tenantId: 'tenant-b', projectId: 'project-b' };
    const updated = bindLocalRecord({ existing: unbound, destination: nextUser });
    expect(updated).toBe(unbound);
    expect(updated.destination).toBe(UNBOUND_DESTINATION);

    const assigned = assignDestination(unbound, nextUser);
    expect(assigned).not.toBe(unbound);
    expect(assigned.id).toBe(unbound.id);
    expect(assigned.version).toBe(1);
    expect(assigned.payload).toEqual(unbound.payload);
    expect(assigned.destination).toEqual({
      kind: 'bound',
      accountId: 'account-b',
      tenantId: 'tenant-b',
      projectId: 'project-b',
    });
    expect(unbound.destination).toBe(UNBOUND_DESTINATION);
    expect(assignDestination(unbound, { accountId: '   ', tenantId: '' })).toBe(unbound);
    const projectAssigned = assignDestination(unbound, { projectId: 'project-explicit' });
    expect(projectAssigned.destination).toEqual({ kind: 'bound', projectId: 'project-explicit' });
    expect(unbound.destination).toBe(UNBOUND_DESTINATION);
  });

  it('refuses to rebind a bound record to a different account or tenant', () => {
    const record = created('ticket', OWNED);
    expect(bindLocalRecord({ existing: record }).destination).toBe(record.destination);
    expect(bindLocalRecord({ existing: record, destination: OWNED }).destination).toBe(record.destination);
    expect(assignDestination(record, { ...OWNED }).destination).toBe(record.destination);

    expect(() => assignDestination(record, { ...OWNED, accountId: 'account-b' })).toThrow('destination_account_mismatch');
    expect(() => bindLocalRecord({ existing: record, destination: { ...OWNED, tenantId: 'tenant-b' } })).toThrow(
      'destination_tenant_mismatch',
    );
    expect(() => assignDestination(record, { accountId: 'account-b', tenantId: 'tenant-b' })).toThrow(
      'destination_tenant_mismatch',
    );
    expect(() => assignDestination(record, { ...OWNED, projectId: 'project-b' })).toThrow('destination_rebind_refused');
    expect(() => assignDestination(record, UNBOUND_DESTINATION)).toThrow('destination_tenant_mismatch');
    expect(record.destination).toEqual({ kind: 'bound', ...OWNED });
    expect(destinationKey(record.destination)).toBe(destinationKey({ kind: 'bound', ...OWNED }));
  });

  it('never reads a live tenant selection', () => {
    const selection = {
      selectedTenantId: 'future-tenant',
      selectedAccountId: 'future-account',
      currentTenant: 'future-tenant',
      tenantId: 'tenant-a',
      accountId: 'account-a',
    };
    const record = created('chat', selection);
    expect(record.destination).toEqual({ kind: 'bound', accountId: 'account-a', tenantId: 'tenant-a' });
    expect(record.destination).not.toHaveProperty('selectedTenantId');
    const lookup = vi.fn(() => ({ kind: 'bound' as const, tenantId: 'from-lookup', accountId: 'from-lookup' }));
    const written: unknown[] = [];
    const missed = refusal(() => {
      const record = createDestinationBoundRecord('chat', {
        id: 'chat-lookup',
        payload: { title: 'Offline' },
        deviceId: 'device-a',
        occurredAt: AT,
        destination: lookup as unknown as EntityDestination,
      });
      written.push(record);
    });
    expect(missed?.code).toBe(UNBOUND_DESTINATION_CODE);
    expect(lookup).not.toHaveBeenCalled();
    expect(written).toEqual([]);

    const readTenant = vi.fn(() => 'tenant-from-session');
    const live = Object.defineProperty({ kind: 'bound' }, 'tenantId', { get: readTenant, enumerable: true });
    const getterMiss = refusal(() => {
      const record = createDestinationBoundRecord('ticket', {
        id: 'ticket-getter',
        payload: { title: 'Offline' },
        deviceId: 'device-a',
        occurredAt: AT,
        destination: live as EntityDestination,
      });
      written.push(record);
    });
    expect(getterMiss?.code).toBe(UNBOUND_DESTINATION_CODE);
    expect(readTenant).not.toHaveBeenCalled();
    expect(written).toEqual([]);
    expect(() => created('chat', { selectedTenantId: 'future-tenant', selectedAccountId: 'future-account' })).toThrow(
      UNBOUND_DESTINATION_CODE,
    );

    const source = readFileSync(fileURLToPath(new URL('./destinationBinding.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/from ['"]vscode['"]|localStorage|sessionStorage|getConfiguration|selectedTenant/);
  });

  it('refuses a second destination that arrives after binding, on every bound path', () => {
    // Both paths a caller can use to move an already-bound record: the
    // explicit assignment and the generic binder. A second destination must be
    // refused by each. (Creation is not one of them — a new record is a new
    // entity and is stamped at creation, which is not a second destination.)
    const attempts: Array<{ label: string; propose: (destination: Record<string, unknown>) => unknown }> = [
      { label: 'assignDestination', propose: (destination) => assignDestination(created('ticket', OWNED), destination) },
      {
        label: 'bindLocalRecord',
        propose: (destination) => bindLocalRecord({ existing: created('ticket', OWNED), destination }),
      },
    ];

    // A different tenant, a different account, a different project, a
    // different repository, and a different platform instance are each a
    // second destination and each is refused.
    const seconds: Array<[string, Record<string, unknown>, DestinationBindingCode]> = [
      ['tenant', { ...OWNED, tenantId: 'tenant-b' }, 'destination_tenant_mismatch'],
      ['account', { ...OWNED, accountId: 'account-b' }, 'destination_account_mismatch'],
      ['project', { ...OWNED, projectId: 'project-b' }, 'destination_rebind_refused'],
      ['repository', { ...OWNED, repository: 'org/other' }, 'destination_rebind_refused'],
      ['platform instance', { ...OWNED, platformInstance: 'https://other.example' }, 'destination_rebind_refused'],
    ];

    for (const { label, propose } of attempts) {
      for (const [field, second, code] of seconds) {
        const error = refusal(() => propose(second));
        expect(error?.code, `${label} accepted a second ${field}`).toBe(code);
      }
    }
  });

  it('refuses a second destination padded with whitespace and never leaves the first', () => {
    const ticket = created('ticket', OWNED);
    const chat = created('chat', OWNED);
    // A padded tenant is still tenant-b, not a new tenant.
    expect(destinationRebindCode(ticket.destination, bindingSnapshot({ ...OWNED, tenantId: '  tenant-b  ' }))).toBe(
      'destination_tenant_mismatch',
    );
    // A blank tenant is not the same tenant either: it trims away to no tenant,
    // which loses the stored one, so it is refused as a mismatch rather than
    // accepted as the identical destination.
    expect(destinationRebindCode(ticket.destination, bindingSnapshot({ ...OWNED, tenantId: '   ' }))).toBe(
      'destination_tenant_mismatch',
    );
    expect(() => assignDestination(ticket, { ...OWNED, tenantId: '  tenant-b  ' })).toThrow(
      'destination_tenant_mismatch',
    );
    expect(() => bindLocalRecord({ existing: chat, destination: { ...OWNED, accountId: '  account-b  ' } })).toThrow(
      'destination_account_mismatch',
    );
    // An unbound proposal is not a second destination; it is a loss of one.
    expect(destinationRebindCode(ticket.destination, UNBOUND_DESTINATION)).toBe('destination_tenant_mismatch');
    expect(() => assignDestination(chat, UNBOUND_DESTINATION)).toThrow('destination_tenant_mismatch');
    // Creating is the one path that stamps a destination without comparing:
    // a new record gets the destination given at creation, once.
    const fresh = createBoundRecord({ ...NEUTRAL_CREATE, destination: OWNED });
    expect(fresh.destination).toEqual({ kind: 'bound', ...OWNED });
    expect(destinationRebindCode(ticket.destination, fresh.destination)).toBeNull();
    // The first destination survives every refusal, unmutated and frozen.
    expect(ticket.destination).toEqual({ kind: 'bound', ...OWNED });
    expect(chat.destination).toEqual({ kind: 'bound', ...OWNED });
    expect(Object.isFrozen(ticket.destination)).toBe(true);
    expect(Object.isFrozen(chat.destination)).toBe(true);
  });

  it('requires a record when neither creating nor updating', () => {
    expect(() => bindLocalRecord({ destination: OWNED })).toThrow('destination_record_required');
  });
});
