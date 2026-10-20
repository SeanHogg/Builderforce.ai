import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID_NOT_UUID,
  CLIENT_ID_REQUIRED,
  MAPPING_CONFLICT,
  SERVER_ID_REQUIRED,
  SERVER_NUMERIC_ID,
  clientIdFor,
  mintClientEntityId,
  rememberServerId,
  serverIdFor,
  type ClientEntityMap,
  type RememberServerIdResult,
} from './clientEntityIdentity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

function stored(result: RememberServerIdResult): Extract<RememberServerIdResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected mapping');
  return result;
}

describe('client entity identity mapping', () => {
  it('mints a UUID string and never a positive integer', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network_denied'));
    try {
      const seen = new Set<string>();
      for (let i = 0; i < 30; i += 1) {
        const id = mintClientEntityId();
        expect(typeof id).toBe('string');
        expect(id).toMatch(UUID);
        expect(id).not.toMatch(POSITIVE_INTEGER);
        expect(Number.isInteger(id)).toBe(false);
        expect(Number.isInteger(Number(id)) && Number(id) > 0).toBe(false);
        expect(id).not.toBeInstanceOf(Promise);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('refuses a local id source that yields a positive integer instead of a UUID', () => {
    const original = globalThis.crypto.randomUUID;
    const randomUUIDSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      42 as unknown as `${string}-${string}-${string}-${string}-${string}`,
    );
    try {
      expect(() => mintClientEntityId()).toThrow(CLIENT_ID_NOT_UUID);
      expect(() => mintClientEntityId()).toThrow(/^client_id_not_uuid$/);
    } finally {
      randomUUIDSpy.mockRestore();
      expect(globalThis.crypto.randomUUID).toBe(original);
    }
  });

  it('stores a server id beside the client UUID and does not replace it', () => {
    const clientId = mintClientEntityId();
    const record = { id: clientId, title: 'written offline' };
    const empty: ClientEntityMap = {};

    const mapped = stored(rememberServerId(empty, record.id, '42'));

    expect(record.id).toBe(clientId);
    expect(mapped.clientId).toBe(clientId);
    expect(mapped.clientId).not.toBe('42');
    expect(mapped.serverId).toBe('42');
    expect(mapped.map).not.toBe(empty);
    expect(empty).toEqual({});
    expect(Object.keys(mapped.map)).toEqual([clientId]);
    expect(mapped.map[clientId]).toBe('42');
    expect(mapped.map['42']).toBeUndefined();
    expect(serverIdFor(mapped.map, clientId)).toBe('42');
    expect(clientIdFor(mapped.map, '42')).toBe(clientId);
  });

  it('looks up either way and keeps each client id when several entities sync', () => {
    const firstId = mintClientEntityId();
    const secondId = mintClientEntityId();
    const first = stored(rememberServerId({}, firstId, '1001'));
    const both = stored(rememberServerId(first.map, secondId, '1002'));

    expect(serverIdFor(both.map, firstId)).toBe('1001');
    expect(serverIdFor(both.map, secondId)).toBe('1002');
    expect(clientIdFor(both.map, '1001')).toBe(firstId);
    expect(clientIdFor(both.map, '1002')).toBe(secondId);
    expect(serverIdFor(both.map, '1001')).toBeUndefined();
    expect(clientIdFor(both.map, firstId)).toBeUndefined();
    expect(Object.keys(both.map)).toEqual([firstId, secondId]);
  });

  it('returns a conflict and leaves the first mapping when a different server id is applied', () => {
    const clientId = mintClientEntityId();
    const first = stored(rememberServerId({}, clientId, '7'));

    const conflict = rememberServerId(first.map, clientId, '8');

    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.conflict).toBe(MAPPING_CONFLICT);
    expect(conflict.map).toBe(first.map);
    expect(conflict.clientId).toBe(clientId);
    expect(conflict.existingClientId).toBe(clientId);
    expect(conflict.existingServerId).toBe('7');
    expect(conflict.rejectedServerId).toBe('8');
    expect(serverIdFor(conflict.map, clientId)).toBe('7');
    expect(clientIdFor(conflict.map, '7')).toBe(clientId);
    expect(clientIdFor(conflict.map, '8')).toBeUndefined();
    expect(Object.keys(conflict.map)).toEqual([clientId]);
  });

  it('treats the same server id applied again as the same mapping', () => {
    const clientId = mintClientEntityId();
    const first = stored(rememberServerId({}, clientId, '7'));
    const again = stored(rememberServerId(first.map, clientId, '7'));

    expect(again.map).toBe(first.map);
    expect(again.clientId).toBe(clientId);
    expect(again.serverId).toBe('7');
    expect(serverIdFor(again.map, clientId)).toBe('7');
    expect(clientIdFor(again.map, '7')).toBe(clientId);
  });

  it('refuses a server id that already belongs to another client id', () => {
    const ownerId = mintClientEntityId();
    const otherId = mintClientEntityId();
    const first = stored(rememberServerId({}, ownerId, '15'));

    const conflict = rememberServerId(first.map, otherId, '15');

    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.conflict).toBe(MAPPING_CONFLICT);
    expect(conflict.map).toBe(first.map);
    expect(conflict.existingClientId).toBe(ownerId);
    expect(conflict.existingServerId).toBe('15');
    expect(conflict.rejectedServerId).toBe('15');
    expect(clientIdFor(conflict.map, '15')).toBe(ownerId);
    expect(serverIdFor(conflict.map, otherId)).toBeUndefined();
  });

  it('keeps the mapping only in the map passed back after a restart', () => {
    const clientId = mintClientEntityId();
    const otherId = mintClientEntityId();
    const saved = stored(rememberServerId({}, clientId, '99'));
    const restarted = JSON.parse(JSON.stringify(saved.map)) as ClientEntityMap;
    const unrelated: ClientEntityMap = {};

    expect(restarted).not.toBe(saved.map);
    expect(serverIdFor(restarted, clientId)).toBe('99');
    expect(clientIdFor(restarted, '99')).toBe(clientId);
    expect(serverIdFor(unrelated, clientId)).toBeUndefined();
    expect(clientIdFor(unrelated, '99')).toBeUndefined();

    const afterRestart = stored(rememberServerId(restarted, otherId, '100'));
    expect(serverIdFor(afterRestart.map, clientId)).toBe('99');
    expect(serverIdFor(saved.map, otherId)).toBeUndefined();
    expect(clientIdFor(saved.map, '100')).toBeUndefined();
  });

  it('refuses a numeric id as the live client key and a blank server id', () => {
    const clientId = mintClientEntityId();
    const empty: ClientEntityMap = {};

    expect(() => rememberServerId(empty, '42', '1')).toThrow(SERVER_NUMERIC_ID);
    expect(() => rememberServerId(empty, '-3', '1')).toThrow(SERVER_NUMERIC_ID);
    expect(() => rememberServerId(empty, '0', '1')).toThrow(SERVER_NUMERIC_ID);
    expect(() => rememberServerId(empty, ' 42 ', '1')).toThrow(CLIENT_ID_REQUIRED);
    expect(() => rememberServerId(empty, '', '1')).toThrow(CLIENT_ID_REQUIRED);
    expect(() => rememberServerId(empty, '   ', '1')).toThrow(CLIENT_ID_REQUIRED);
    expect(() => rememberServerId(empty, clientId, '')).toThrow(SERVER_ID_REQUIRED);
    expect(() => rememberServerId(empty, clientId, '   ')).toThrow(SERVER_ID_REQUIRED);
    expect(empty).toEqual({});
    expect(serverIdFor(empty, '42')).toBeUndefined();
    expect(clientIdFor(empty, '1')).toBeUndefined();
  });
});
