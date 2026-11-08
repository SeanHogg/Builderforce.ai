import { describe, expect, it } from 'vitest';
import { linkChatTicket } from './chatTicketLink.js';
import { ingestServerRecords, type ServerRecordRow } from './ingestServerRecords.js';
import type { ChatTicketLinkValue, EntityDestination, TicketValue } from './records.js';
import { UNBOUND_DESTINATION } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from './store.js';
import { deriveRecordSyncStatus } from './syncStatus.js';

const ACCOUNT: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '7' };
const CHAT = '00000000-0000-4000-8000-0000000000c1';
const NOW = () => new Date('2026-11-08T00:00:00.000Z');

function ticketRow(serverId: string, title = 'Fix it'): ServerRecordRow {
  const payload: TicketValue = { projectId: '3', title, status: 'backlog' };
  return { entityType: 'ticket', serverId, payload, updatedAt: '2026-11-07T00:00:00.000Z', destination: ACCOUNT };
}

async function ticketsOf(store: LocalFirstStore) {
  return store.read((tx) => tx.list<TicketValue>('ticket'));
}

describe('ingestServerRecords', () => {
  it('mints stable client ids: a second ingest reaches the same records', async () => {
    const store = createMemoryLocalFirstStore();
    const first = await ingestServerRecords(store, [ticketRow('11'), ticketRow('12', 'Other')], { now: NOW });
    const idsAfterFirst = (await ticketsOf(store)).map((row) => row.id).sort();
    const second = await ingestServerRecords(store, [ticketRow('11'), ticketRow('12', 'Other')], { now: NOW });
    const idsAfterSecond = (await ticketsOf(store)).map((row) => row.id).sort();
    expect(idsAfterSecond).toEqual(idsAfterFirst);
    expect(idsAfterFirst).toHaveLength(2);
    expect(second.clientIds).toEqual(first.clientIds);
    const mapping = await store.read((tx) => tx.mappingByServerId('ticket', '11'));
    expect(mapping?.clientEntityId).toBe(first.clientIds[0]);
  });

  it('writes imported / server-observed provenance, and the record presents as synced', async () => {
    const store = createMemoryLocalFirstStore();
    await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    const [row] = await ticketsOf(store);
    expect(row?.provenance).toMatchObject({ source: 'imported', evidence: 'server-observed' });
    expect(deriveRecordSyncStatus({ record: row! })).toBe('synced');
  });

  it('equal payload: no version bump and nothing written', async () => {
    const store = createMemoryLocalFirstStore();
    await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    const before = (await ticketsOf(store))[0]!;
    const again = await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    const after = (await ticketsOf(store))[0]!;
    expect(again).toMatchObject({ written: 0, unchanged: 1 });
    expect(after.version).toBe(before.version);
    const changed = await ingestServerRecords(store, [ticketRow('11', 'Renamed')], { now: NOW });
    expect(changed.written).toBe(1);
    expect((await ticketsOf(store))[0]!.version).toBe(before.version + 1);
  });

  it('the same payload with a different key order is unchanged, not rewritten', async () => {
    const store = createMemoryLocalFirstStore();
    await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    const before = (await ticketsOf(store))[0]!;
    const reordered: ServerRecordRow = { ...ticketRow('11'), payload: { status: 'backlog', title: 'Fix it', projectId: '3' } };
    const again = await ingestServerRecords(store, [reordered], { now: NOW });
    expect(again).toMatchObject({ written: 0, unchanged: 1 });
    expect((await ticketsOf(store))[0]!.version).toBe(before.version);
  });

  it('does not overwrite a record with a pending local event', async () => {
    const store = createMemoryLocalFirstStore();
    const { clientIds } = await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    const id = clientIds[0]!;
    await store.transact(async (tx) => {
      const local = (await tx.get<TicketValue>('ticket', id))!;
      await tx.put({ ...local, version: local.version + 1, payload: { ...local.payload, title: 'Local edit' } });
      await tx.append({
        clientEntityId: id,
        entityType: 'ticket',
        operation: 'update',
        schemaVersion: 1,
        occurredAt: '2026-11-08T00:00:00.000Z',
        dependsOn: [],
        destination: ACCOUNT,
        payload: { title: 'Local edit' },
      });
    });
    const result = await ingestServerRecords(store, [ticketRow('11', 'Server edit')], { now: NOW });
    expect(result.skippedPending).toBe(1);
    expect((await ticketsOf(store))[0]!.payload.title).toBe('Local edit');
  });

  it('a complete list tombstones a local link the server dropped, and keeps the listed one', async () => {
    const store = createMemoryLocalFirstStore();
    const ticketA = '00000000-0000-4000-8000-0000000000a1';
    const ticketB = '00000000-0000-4000-8000-0000000000a2';
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({ id: CHAT, entityType: 'chat', payload: { title: 'c' }, deviceId: 'd', destination: UNBOUND_DESTINATION }));
      for (const id of [ticketA, ticketB]) {
        await tx.put(newLocalRecord({ id, entityType: 'ticket', payload: { projectId: '3', title: id, status: 'backlog' }, deviceId: 'd' }));
      }
    });
    const stable = (ticket: string) => ({ chatClientId: CHAT, ticketClientId: ticket, linkType: 'linked' as const, deviceId: 'd' });
    const linkA = await linkChatTicket(store, stable(ticketA));
    const linkB = await linkChatTicket(store, stable(ticketB));
    // Their sync events are not pending any more: the server holds both.
    await store.transact(async (tx) => {
      await tx.acknowledge((await tx.pending()).map((event) => event.eventId));
    });
    const keep: ServerRecordRow = {
      entityType: 'chat-ticket-link',
      serverId: '501',
      payload: { chatClientId: CHAT, ticketClientId: ticketA, linkType: 'linked' } satisfies ChatTicketLinkValue,
      updatedAt: '2026-11-07T00:00:00.000Z',
      destination: UNBOUND_DESTINATION,
    };
    const result = await ingestServerRecords(store, [keep], { completeListFor: { chatClientId: CHAT, total: 1 }, now: NOW });
    expect(result.tombstoned).toBe(1);
    const links = await store.read((tx) => tx.list<ChatTicketLinkValue>('chat-ticket-link'));
    const byTicket = new Map(links.map((link) => [link.payload.ticketClientId, link]));
    expect(byTicket.get(ticketB)?.deletedAt).toBeTruthy();
    expect(byTicket.get(ticketB)?.id).toBe(linkB.id);
    expect(byTicket.get(ticketA)?.deletedAt).toBeUndefined();
    expect(byTicket.get(ticketA)?.id).toBe(linkA.id);
  });

  it('an incomplete read (no completeListFor) never tombstones', async () => {
    const store = createMemoryLocalFirstStore();
    const result = await ingestServerRecords(store, [ticketRow('11')], { now: NOW });
    expect(result.tombstoned).toBe(0);
  });

  it('is one transaction: a failure mid-batch writes nothing', async () => {
    const store = createMemoryLocalFirstStore();
    const poisoned = {
      ...ticketRow('12'),
      get payload(): unknown {
        throw new Error('boom');
      },
    } as ServerRecordRow;
    await expect(ingestServerRecords(store, [ticketRow('11'), poisoned], { now: NOW })).rejects.toThrow('boom');
    expect(await ticketsOf(store)).toHaveLength(0);
    expect(await store.read((tx) => tx.mappingByServerId('ticket', '11'))).toBeUndefined();
  });
});

describe('ingestServerRecords: complete lists and mappings', () => {
  const TICKET_A = '00000000-0000-4000-8000-0000000000a1';
  const TICKET_B = '00000000-0000-4000-8000-0000000000a2';
  const OTHER_CHAT = '00000000-0000-4000-8000-0000000000c2';

  async function seeded() {
    const store = createMemoryLocalFirstStore();
    await store.transact(async (tx) => {
      for (const id of [CHAT, OTHER_CHAT]) {
        await tx.put(newLocalRecord({ id, entityType: 'chat', payload: { title: id }, deviceId: 'd', destination: UNBOUND_DESTINATION }));
      }
      for (const id of [TICKET_A, TICKET_B]) {
        await tx.put(newLocalRecord({ id, entityType: 'ticket', payload: { projectId: '3', title: id, status: 'backlog' }, deviceId: 'd' }));
      }
    });
    return store;
  }
  const linkRow = (chat: string, ticket: string, serverId: string): ServerRecordRow => ({
    entityType: 'chat-ticket-link',
    serverId,
    payload: { chatClientId: chat, ticketClientId: ticket, linkType: 'linked' },
    updatedAt: '2026-11-07T00:00:00.000Z',
    destination: UNBOUND_DESTINATION,
  });
  const syncedAway = async (store: LocalFirstStore) => {
    await store.transact(async (tx) => { await tx.acknowledge((await tx.pending()).map((event) => event.eventId)); });
  };
  const linksOf = (store: LocalFirstStore) => store.read((tx) => tx.list<ChatTicketLinkValue>('chat-ticket-link'));
  const link = (chat: string, ticket: string) => ({ chatClientId: chat, ticketClientId: ticket, deviceId: 'd', linkType: 'linked' as const });

  it('a partial page (fewer tickets than total) tombstones nothing', async () => {
    const store = await seeded();
    await linkChatTicket(store, link(CHAT, TICKET_A));
    await linkChatTicket(store, link(CHAT, TICKET_B));
    await syncedAway(store);
    const result = await ingestServerRecords(store, [linkRow(CHAT, TICKET_A, '501')], { completeListFor: { chatClientId: CHAT, total: 2 }, now: NOW });
    expect(result.tombstoned).toBe(0);
    expect((await linksOf(store)).every((row) => !row.deletedAt)).toBe(true);
  });

  it('keeps a link with a pending local event, and leaves another chat untouched', async () => {
    const store = await seeded();
    await linkChatTicket(store, link(CHAT, TICKET_B));            // pending: not yet synced
    await linkChatTicket(store, link(OTHER_CHAT, TICKET_B));
    await syncedAway(store);
    await linkChatTicket(store, link(CHAT, TICKET_B));            // no-op, no event
    await store.transact(async (tx) => {                          // an unsynced local edit on CHAT's link
      const row = (await tx.list<ChatTicketLinkValue>('chat-ticket-link')).find((r) => r.payload.chatClientId === CHAT)!;
      await tx.append({ clientEntityId: row.id, entityType: 'chat-ticket-link', operation: 'update', schemaVersion: 1, occurredAt: NOW().toISOString(), dependsOn: [], destination: UNBOUND_DESTINATION, payload: row.payload });
    });
    const result = await ingestServerRecords(store, [linkRow(CHAT, TICKET_A, '501')], { completeListFor: { chatClientId: CHAT, total: 1 }, now: NOW });
    expect(result.tombstoned).toBe(0);
    const byChat = new Map((await linksOf(store)).map((row) => [row.payload.chatClientId + row.payload.ticketClientId, row]));
    expect(byChat.get(CHAT + TICKET_B)?.deletedAt).toBeUndefined();
    expect(byChat.get(OTHER_CHAT + TICKET_B)?.deletedAt).toBeUndefined();
  });

  it('does not reset an existing derived-id mapping to version 1', async () => {
    const store = await seeded();
    const created = await linkChatTicket(store, link(CHAT, TICKET_A));
    await syncedAway(store);
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: 'chat-ticket-link', clientEntityId: created.id, serverId: '0', serverVersion: 4 });
    });
    await ingestServerRecords(store, [linkRow(CHAT, TICKET_A, '501')], { now: NOW });
    const mapping = await store.read((tx) => tx.mapping('chat-ticket-link', created.id, UNBOUND_DESTINATION));
    expect(mapping).toMatchObject({ serverId: '501', serverVersion: 4 });
  });
});
