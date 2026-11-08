import { describe, expect, it } from 'vitest';
import { chatTicketLinkId, linkChatTicket, unlinkChatTicket } from './chatTicketLink.js';
import { importKey } from './journalRules.js';
import type { ChatTicketLinkValue, EntityDestination } from './records.js';
import { UNBOUND_DESTINATION } from './records.js';
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from './store.js';
import { bindWorkForSync } from './workBinding.js';

const CHAT = '00000000-0000-4000-8000-0000000000c1';
const TICKET = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT: EntityDestination = { kind: 'bound', platformInstance: 'https://builderforce.ai', tenantId: '7' };
const input = { chatClientId: CHAT, ticketClientId: TICKET, deviceId: 'device-1' };

async function seed(store: LocalFirstStore, destination: EntityDestination = UNBOUND_DESTINATION) {
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord({ id: CHAT, entityType: 'chat', payload: { title: 'c' }, deviceId: 'device-1', destination }));
    await tx.put(newLocalRecord({ id: TICKET, entityType: 'ticket', payload: { projectId: '3', title: 't', status: 'backlog' }, deviceId: 'device-1', destination }));
  });
}

describe('chat-ticket-link', () => {
  it('derives a stable UUID-shaped id from the two client ids', () => {
    const id = chatTicketLinkId(CHAT, TICKET);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(chatTicketLinkId(CHAT, TICKET)).toBe(id);
    expect(chatTicketLinkId(TICKET, CHAT)).not.toBe(id);
  });

  it('links once (idempotent), waits on the chat and ticket imports, and never downgrades created', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const first = await linkChatTicket(store, { ...input, linkType: 'created' });
    const again = await linkChatTicket(store, { ...input, linkType: 'linked' });
    expect(again.version).toBe(first.version);
    expect(again.payload.linkType).toBe('created');
    const events = await store.read((tx) => tx.pending());
    expect(events).toHaveLength(1);
    expect(events[0]?.entityType).toBe('chat-ticket-link');
    expect(events[0]?.dependsOn).toEqual([importKey('chat', CHAT), importKey('ticket', TICKET)]);
  });

  it('refuses a link whose chat or ticket is not on the device', async () => {
    const store = createMemoryLocalFirstStore();
    await expect(linkChatTicket(store, { ...input, linkType: 'linked' })).rejects.toThrow('chat_not_found');
  });

  it('unlink tombstones the record and a second unlink is a no-op', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const link = await linkChatTicket(store, { ...input, linkType: 'linked' });
    expect(await unlinkChatTicket(store, input)).toBe(true);
    expect(await unlinkChatTicket(store, input)).toBe(false);
    const row = await store.read((tx) => tx.get<ChatTicketLinkValue>('chat-ticket-link', link.id));
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.version).toBe(link.version + 1);
  });

  it('binding the work queues the link import behind its chat and ticket', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    await linkChatTicket(store, { ...input, linkType: 'linked' });
    expect(await bindWorkForSync(store, 'device-1', ACCOUNT)).toBeGreaterThanOrEqual(1);
    const events = await store.read((tx) => tx.pending(ACCOUNT));
    const linkImport = events.find((event) => event.entityType === 'chat-ticket-link');
    expect(linkImport?.operation).toBe('import');
    expect(linkImport?.dependsOn).toEqual(expect.arrayContaining([importKey('chat', CHAT), importKey('ticket', TICKET)]));
  });
});

describe('chat-ticket-link server ids', () => {
  async function mapBoth(store: LocalFirstStore) {
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: 'chat', clientEntityId: CHAT, serverId: '5', serverVersion: 1 });
      await tx.putMapping({ destination: UNBOUND_DESTINATION, entityType: 'ticket', clientEntityId: TICKET, serverId: '9', serverVersion: 1 });
    });
  }

  it('writes chatServerId and ticketServerId when the device maps them', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    await mapBoth(store);
    const link = await linkChatTicket(store, { ...input, linkType: 'linked' });
    expect(link.payload).toEqual({ chatClientId: CHAT, ticketClientId: TICKET, chatServerId: '5', ticketServerId: '9', linkType: 'linked' });
  });

  it('omits them when nothing is mapped', async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const link = await linkChatTicket(store, { ...input, linkType: 'linked' });
    expect(link.payload).toEqual({ chatClientId: CHAT, ticketClientId: TICKET, linkType: 'linked' });
  });

  it('the delete an ingested (server-made) link journals carries the pair and server ids', async () => {
    const { ingestServerRecords } = await import('./ingestServerRecords.js');
    const store = createMemoryLocalFirstStore();
    await seed(store, ACCOUNT);
    await store.transact(async (tx) => {
      await tx.putMapping({ destination: ACCOUNT, entityType: 'chat', clientEntityId: CHAT, serverId: '5', serverVersion: 1 });
      await tx.putMapping({ destination: ACCOUNT, entityType: 'ticket', clientEntityId: TICKET, serverId: '9', serverVersion: 1 });
    });
    await ingestServerRecords(store, [{
      entityType: 'chat-ticket-link',
      serverId: '501',
      payload: { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'linked' },
      updatedAt: '2026-11-07T00:00:00.000Z',
      destination: ACCOUNT,
    }]);
    const id = chatTicketLinkId(CHAT, TICKET);
    const ingested = await store.read((tx) => tx.get<ChatTicketLinkValue>('chat-ticket-link', id));
    expect(ingested?.payload).toMatchObject({ chatServerId: '5', ticketServerId: '9' });
    expect(await unlinkChatTicket(store, input)).toBe(true);
    const events = await store.read((tx) => tx.pending(ACCOUNT));
    const sent = events.find((event) => event.entityType === 'chat-ticket-link');
    expect(sent?.operation).toBe('delete');
    expect(sent?.payload).toMatchObject({ chatClientId: CHAT, ticketClientId: TICKET, chatServerId: '5', ticketServerId: '9' });
  });

  it('a retype of an ingested link sends the update with the payload', async () => {
    const { ingestServerRecords } = await import('./ingestServerRecords.js');
    const store = createMemoryLocalFirstStore();
    await seed(store, ACCOUNT);
    await ingestServerRecords(store, [{
      entityType: 'chat-ticket-link',
      serverId: '501',
      payload: { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'linked' },
      updatedAt: '2026-11-07T00:00:00.000Z',
      destination: ACCOUNT,
    }]);
    await linkChatTicket(store, { ...input, linkType: 'created' });
    const sent = (await store.read((tx) => tx.pending(ACCOUNT))).find((event) => event.entityType === 'chat-ticket-link');
    expect(sent?.operation).toBe('update');
    expect(sent?.payload).toMatchObject({ linkType: 'created' });
  });
});
