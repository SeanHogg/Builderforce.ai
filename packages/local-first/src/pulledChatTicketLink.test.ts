/**
 * regression: a pulled `chat-ticket-link` lands in the device form (chat #282, 2026-11-21).
 * The server serves a link back as `{ chatId, ticketId, linkType }`; stored verbatim it lost its
 * client ids and fell off its chat's rail.
 */
import { describe, expect, it } from 'vitest';
import { chatTicketLinkId } from './chatTicketLink.js';
import { ingestServerRecords } from './ingestServerRecords.js';
import { createPlatformPolicy } from './policy.js';
import { destinationKey, type EntityDestination } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from './store.js';
import { createSyncCoordinator } from './sync.js';

const AT = '2026-11-21T19:29:35.105Z';
const BOUND: EntityDestination = { kind: 'bound', platformInstance: 'https://api.example', tenantId: '1' };
const CHAT = '730aabd3-7307-48c6-8300-0b82e466c961';
const TICKET = 'ad27cd0a-ee7a-495e-aee7-e7272576b622';
const LINK = chatTicketLinkId(CHAT, TICKET);
/** The same pair as ANOTHER device derives it (its own chat / ticket client ids). */
const FOREIGN_LINK = chatTicketLinkId('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
const SERVER_FORM = { chatId: '282', ticketId: '6980', linkType: 'created' };

async function parents(store: LocalFirstStore, options: { ticketMapped: boolean }): Promise<void> {
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({ id: CHAT, entityType: 'chat', deviceId: 'd', destination: BOUND, payload: { clientId: CHAT, chat: { id: 165961 } } }));
    await tx.putMapping({ destination: BOUND, entityType: 'chat', clientEntityId: CHAT, syncId: 282 as never, serverId: '282', serverVersion: 2 });
    await tx.put(newLocalRecord({ id: TICKET, entityType: 'ticket', deviceId: 'd', destination: BOUND, payload: { title: 'T', status: 'backlog' } }));
    if (options.ticketMapped) {
      await tx.putMapping({ destination: BOUND, entityType: 'ticket', clientEntityId: TICKET, syncId: 6980 as never, serverId: '6980', serverVersion: 2 });
    }
  });
}

async function putLink(store: LocalFirstStore, id: string, payload: object): Promise<void> {
  await store.transact((tx) => tx.put(newLocalRecord({ id, entityType: 'chat-ticket-link', deviceId: 'd', destination: BOUND, payload })));
}

/** One sync round whose pull serves the link `payload` under `id`; answers the round's summary. */
async function pull(store: LocalFirstStore, payload: unknown, id = LINK, serverKey = 900) {
  const policy = createPlatformPolicy();
  policy.set({ synchronize: true });
  return createSyncCoordinator({
    store, policy, deviceId: 'd', lease: { run: (_owner, work) => work() },
    transport: {
      push: async () => [],
      pull: async () => ({
        records: payload === undefined ? [] : [{
          id, entityType: 'chat-ticket-link', schemaVersion: 1, version: 1, destination: BOUND,
          occurredAt: AT, updatedAt: AT, payload, syncId: serverKey, serverId: String(serverKey),
        }] as never[],
      }),
    },
  }).synchronize(BOUND);
}

const linkOf = (store: LocalFirstStore, id = LINK) => store.read((tx) => tx.get('chat-ticket-link', id));

describe('regression: a pulled chat-ticket-link is stored in the device form', () => {
  it('a link the device never held resolves its client ids through the chat and ticket mappings', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await pull(store, SERVER_FORM);
    expect((await linkOf(store))?.payload).toEqual({
      chatClientId: CHAT, ticketClientId: TICKET, chatServerId: '282', ticketServerId: '6980', linkType: 'created',
    });
  });

  it("a 'created' link the device holds is never downgraded by a pulled 'linked' one, in either form", async () => {
    for (const pulled of [{ ...SERVER_FORM, linkType: 'linked' }, { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'linked' }]) {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
      await pull(store, pulled);
      expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
    }
  });

  it('a link whose ticket this device does not map is not stored, nor counted as pulled; its mapping still is', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: false });
    const summary = await pull(store, SERVER_FORM);
    expect(await linkOf(store)).toBeUndefined();
    expect(summary?.pulled).toBe(0);
    // Not resolvable here: no mapping at all (never one under the pulled id).
    expect(await store.read((tx) => tx.mapping('chat-ticket-link', LINK, BOUND))).toBeUndefined();
  });

  it("another device's link (its derived id) is not stored under that id; the rail's ingest lands it under this device's", async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await pull(store, SERVER_FORM, FOREIGN_LINK);
    expect(await linkOf(store, FOREIGN_LINK)).toBeUndefined();
    expect(await linkOf(store)).toBeUndefined();
    // The rail refresh lists the same link (server row 900) in the device form.
    await ingestServerRecords(store, [{
      entityType: 'chat-ticket-link', serverId: '900', updatedAt: AT, destination: BOUND,
      payload: { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' },
    }]);
    expect(await linkOf(store, FOREIGN_LINK)).toBeUndefined();
    expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
    expect(await store.read((tx) => tx.mapping('chat-ticket-link', LINK, BOUND))).toMatchObject({ serverId: '900' });
  });

  it('the repair puts a server-form link back in the device form, and retires a foreign-id copy of the pair', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await putLink(store, LINK, SERVER_FORM);
    await putLink(store, FOREIGN_LINK, SERVER_FORM);
    await pull(store, undefined);
    expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
    expect((await linkOf(store, FOREIGN_LINK))?.deletedAt).toBeTruthy();
  });

  describe("an older build's foreign-id link in the DEVICE form (mapped F -> 900)", () => {
    const deviceForm = { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' };
    async function seeded(): Promise<LocalFirstStore> {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, FOREIGN_LINK, deviceForm);
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: FOREIGN_LINK, serverId: '900', serverVersion: 1 }));
      return store;
    }
    const liveLinks = async (store: LocalFirstStore) =>
      (await store.export()).records.filter((r) => r.entityType === 'chat-ticket-link' && !r.deletedAt).map((r) => r.id);
    const railRow = { entityType: 'chat-ticket-link' as const, serverId: '900', updatedAt: AT, destination: BOUND, payload: deviceForm };

    it("the rail's ingest leaves ONE live link, under the derived id; a second ingest writes nothing", async () => {
      const store = await seeded();
      await ingestServerRecords(store, [railRow], { completeListFor: { chatClientId: CHAT, total: 1 } });
      expect(await liveLinks(store)).toEqual([LINK]);
      const second = await ingestServerRecords(store, [railRow], { completeListFor: { chatClientId: CHAT, total: 1 } });
      expect(second).toMatchObject({ written: 0, tombstoned: 0 });
      expect(await liveLinks(store)).toEqual([LINK]);
    });

    it('the pull moves it to the derived id (with its server mapping) and retires the stray', async () => {
      const store = await seeded();
      await pull(store, undefined);
      expect(await liveLinks(store)).toEqual([LINK]);
      expect((await linkOf(store))?.payload).toEqual(deviceForm);
      expect(await store.read((tx) => tx.mapping('chat-ticket-link', LINK, BOUND))).toMatchObject({ serverId: '900' });
      const stray = await linkOf(store, FOREIGN_LINK);
      expect(stray?.deletedAt).toBeTruthy();
      expect(stray?.provenance).toMatchObject({ evidence: 'server-observed' });
      // The server's word: no journal event.
      expect((await store.export()).events.filter((e) => e.entityType === 'chat-ticket-link')).toEqual([]);
    });
  });

  it("a pulled unlink of another device's link (its id) tombstones the pair where this device holds it", async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await putLink(store, LINK, { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
    await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: LINK, syncId: 900 as never, serverId: '900', serverVersion: 1 }));
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    await createSyncCoordinator({
      store, policy, deviceId: 'd', lease: { run: (_owner, work) => work() },
      transport: {
        push: async () => [],
        pull: async () => ({
          records: [{
            id: FOREIGN_LINK, entityType: 'chat-ticket-link', schemaVersion: 1, version: 2, destination: BOUND,
            // The real server tombstone payload (`importSyncedChatTicketLink.ts`).
            occurredAt: AT, updatedAt: AT, deletedAt: AT, payload: { removed: true }, syncId: 900, serverId: '900',
          }] as never[],
        }),
      },
    }).synchronize(BOUND);
    expect((await linkOf(store))?.deletedAt).toBeTruthy();
  });

  it('a link pulled before its ticket in the same page is stored (links merge after the page\'s other rows)', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: false });
    const policy = createPlatformPolicy();
    policy.set({ synchronize: true });
    await createSyncCoordinator({
      store, policy, deviceId: 'd', lease: { run: (_owner, work) => work() },
      transport: {
        push: async () => [],
        pull: async () => ({
          records: [
            { id: LINK, entityType: 'chat-ticket-link', schemaVersion: 1, version: 1, destination: BOUND, occurredAt: AT, updatedAt: AT, payload: SERVER_FORM, syncId: 900, serverId: '900' },
            { id: TICKET, entityType: 'ticket', schemaVersion: 1, version: 1, destination: BOUND, occurredAt: AT, updatedAt: AT, payload: { title: 'T', status: 'backlog' }, syncId: 6980, serverId: '6980' },
          ] as never[],
        }),
      },
    }).synchronize(BOUND);
    expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
  });

  describe('a pulled unlink reaches every copy of the pair (the server tombstone payload is { removed: true })', () => {
    const DEVICE_FORM = { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' };
    const tombstone = (id: string, serverKey = 900) => ({
      id, entityType: 'chat-ticket-link', schemaVersion: 1, version: 2, destination: BOUND,
      occurredAt: AT, updatedAt: AT, deletedAt: AT, payload: { removed: true }, syncId: serverKey, serverId: String(serverKey),
    });
    async function pullRecords(store: LocalFirstStore, records: object[]): Promise<void> {
      const policy = createPlatformPolicy();
      policy.set({ synchronize: true });
      await createSyncCoordinator({
        store, policy, deviceId: 'd', lease: { run: (_owner, work) => work() },
        transport: { push: async () => [], pull: async () => ({ records: records as never[] }) },
      }).synchronize(BOUND);
    }
    const railRow = { entityType: 'chat-ticket-link' as const, serverId: '900', updatedAt: AT, destination: BOUND, payload: DEVICE_FORM };
    const mappingOf = (store: LocalFirstStore, id: string) => store.read((tx) => tx.mapping('chat-ticket-link', id, BOUND));

    it("regression: an existing stray mapping X -> 900 written FIRST no longer hides this device's copy (earliest mapping of the key)", async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: FOREIGN_LINK, syncId: 900 as never, serverId: '900', serverVersion: 1 }));
      await ingestServerRecords(store, [railRow]);
      expect((await linkOf(store))?.deletedAt).toBeUndefined();
      await pullRecords(store, [tombstone(FOREIGN_LINK)]);
      expect((await linkOf(store))?.deletedAt).toBeTruthy();
    });

    it("a refused link's mapping is written under THIS device's derived id, never the pulled one; the later unlink reaches the stored copy", async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await pull(store, SERVER_FORM, FOREIGN_LINK);
      expect(await mappingOf(store, FOREIGN_LINK)).toBeUndefined();
      expect(await mappingOf(store, LINK)).toMatchObject({ serverId: '900' });
      await ingestServerRecords(store, [railRow]);
      expect((await linkOf(store))?.deletedAt).toBeUndefined();
      await pullRecords(store, [tombstone(FOREIGN_LINK)]);
      expect((await linkOf(store))?.deletedAt).toBeTruthy();
    });

    it("regression: the pair unlinked then linked again under K2 replaces the derived record's OLDER mapping, so K2's unlink reaches it", async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, DEVICE_FORM);
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: LINK, syncId: 900 as never, serverId: '900', serverVersion: 3 }));
      // Another device's link of the pair, served under K2 = 901 (refused: not this device's id).
      await pull(store, SERVER_FORM, FOREIGN_LINK, 901);
      expect(await mappingOf(store, LINK)).toMatchObject({ syncId: 901, serverId: '901', serverVersion: 3 });
      await pullRecords(store, [tombstone(FOREIGN_LINK, 901)]);
      expect((await linkOf(store))?.deletedAt).toBeTruthy();
    });

    it('a refused link naming the key the derived record already carries leaves its mapping untouched', async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, DEVICE_FORM);
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: LINK, syncId: 900 as never, serverId: '900', serverVersion: 5 }));
      await pull(store, SERVER_FORM, FOREIGN_LINK, 900);
      expect(await mappingOf(store, LINK)).toMatchObject({ syncId: 900, serverVersion: 5 });
    });

    it('a page of many link tombstones reaches every copy (the live-link index is built once and tracks what it tombstoned)', async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, DEVICE_FORM);
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: LINK, syncId: 900 as never, serverId: '900', serverVersion: 1 }));
      await putLink(store, FOREIGN_LINK, DEVICE_FORM);
      const other = 'link:other-pair';
      await putLink(store, other, { chatClientId: CHAT, ticketClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', linkType: 'linked' });
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: other, syncId: 902 as never, serverId: '902', serverVersion: 1 }));
      await pullRecords(store, [tombstone(LINK, 900), tombstone('gone-id', 900), tombstone(other, 902)]);
      const live = (await store.export()).records.filter((r) => r.entityType === 'chat-ticket-link' && !r.deletedAt);
      expect(live).toEqual([]);
    });

    it('a pulled tombstone of the derived record also tombstones a stray of the same pair: the retire step does not resurrect it', async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, DEVICE_FORM);
      await store.transact((tx) => tx.putMapping({ destination: BOUND, entityType: 'chat-ticket-link', clientEntityId: LINK, syncId: 900 as never, serverId: '900', serverVersion: 1 }));
      await putLink(store, FOREIGN_LINK, DEVICE_FORM);
      await pullRecords(store, [tombstone(LINK)]);
      const live = (await store.export()).records.filter((r) => r.entityType === 'chat-ticket-link' && !r.deletedAt);
      expect(live).toEqual([]);
      expect((await linkOf(store, FOREIGN_LINK))?.deletedAt).toBeTruthy();
    });
  });

  describe('retire when the derived record is a tombstone', () => {
    const DEVICE_FORM = { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' };
    async function seeded(unlinkedAt: string): Promise<LocalFirstStore> {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, FOREIGN_LINK, DEVICE_FORM);
      await store.transact((tx) => tx.put({
        ...newLocalRecord({ id: LINK, entityType: 'chat-ticket-link', deviceId: 'd', destination: BOUND, payload: DEVICE_FORM }),
        deletedAt: unlinkedAt,
      }));
      return store;
    }

    it('a stray NEWER than the unlink revives the derived record (the pair was linked again)', async () => {
      const store = await seeded('2000-01-01T00:00:00.000Z');
      await pull(store, undefined);
      expect((await linkOf(store))?.deletedAt).toBeUndefined();
      expect((await linkOf(store))?.payload).toMatchObject(DEVICE_FORM);
      expect((await linkOf(store, FOREIGN_LINK))?.deletedAt).toBeTruthy();
    });

    it('a stray OLDER than the unlink is retired and the pair stays unlinked', async () => {
      const store = await seeded('2999-01-01T00:00:00.000Z');
      await pull(store, undefined);
      expect((await linkOf(store))?.deletedAt).toBeTruthy();
      expect((await linkOf(store, FOREIGN_LINK))?.deletedAt).toBeTruthy();
    });
  });

  describe('the legacy repair is one-shot', () => {
    it('marks the destination after the first pull; a stray stored later is not rescanned', async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await pull(store, undefined);
      expect(await store.read((tx) => tx.readMark(`linkFormRepair:v1:${destinationKey(BOUND)}`))).toBeTruthy();
      await putLink(store, FOREIGN_LINK, { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'created' });
      await pull(store, undefined);
      expect((await linkOf(store, FOREIGN_LINK))?.deletedAt).toBeUndefined();
    });

    it('a legacy row skipped for a live pending event leaves the mark unset; once the event clears, the next pull repairs it and marks', async () => {
      const store = createMemoryLocalFirstStore();
      await parents(store, { ticketMapped: true });
      await putLink(store, LINK, SERVER_FORM);
      const event = await store.transact((tx) => tx.append({
        idempotencyKey: `chat-ticket-link:${LINK}:v2`, clientEntityId: LINK, entityType: 'chat-ticket-link', operation: 'update',
        schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: SERVER_FORM,
      }));
      const marked = () => store.read((tx) => tx.readMark(`linkFormRepair:v1:${destinationKey(BOUND)}`));
      await pull(store, undefined);
      expect((await linkOf(store))?.payload).toEqual(SERVER_FORM);
      expect(await marked()).toBeFalsy();
      await store.transact((tx) => tx.deadLetter(event.eventId, 'rejected', AT));
      await pull(store, undefined);
      expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET });
      expect(await marked()).toBeTruthy();
    });
  });

  it('a dead-lettered event is not a pending edit: the repair still puts the link back in the device form', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await putLink(store, LINK, SERVER_FORM);
    await store.transact(async (tx) => {
      const event = await tx.append({
        idempotencyKey: `chat-ticket-link:${LINK}:v2`, clientEntityId: LINK, entityType: 'chat-ticket-link', operation: 'update',
        schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: SERVER_FORM,
      });
      await tx.deadLetter(event.eventId, 'rejected', AT);
    });
    await pull(store, undefined);
    expect((await linkOf(store))?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET });
  });

  it('the repair skips a link with a pending local event', async () => {
    const store = createMemoryLocalFirstStore();
    await parents(store, { ticketMapped: true });
    await putLink(store, LINK, SERVER_FORM);
    await store.transact((tx) => tx.append({
      idempotencyKey: `chat-ticket-link:${LINK}:v2`, clientEntityId: LINK, entityType: 'chat-ticket-link', operation: 'update',
      schemaVersion: 1, occurredAt: AT, dependsOn: [], destination: BOUND, payload: SERVER_FORM,
    }));
    await pull(store, undefined);
    expect((await linkOf(store))?.payload).toEqual(SERVER_FORM);
  });
});
