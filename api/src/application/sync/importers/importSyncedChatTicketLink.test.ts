import { describe, expect, it, vi } from 'vitest';
import { hashSyncPayload } from '../../../domain/sync/syncProtocol';
import type { SyncEntityMappingRow, SyncStoreSet } from '../syncPorts';
import { boundKey, ctx, dbOf, event, mapping, stores } from './__fixtures__/importerHarness';
import { importSyncedChatTicketLink } from './importSyncedChatTicketLink';

vi.mock('../../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: async () => 'seg-1' }));

const CHAT = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';
const LINK = '44444444-4444-4444-8444-444444444444';
const payload = { chatClientId: CHAT, ticketClientId: TICKET, linkType: 'linked' };

/** A store set whose mapping lookup answers per entity type. */
function storesWith(byType: Partial<Record<string, SyncEntityMappingRow | null>>): SyncStoreSet {
  return { ...stores(), findMapping: async (_tenant, type) => byType[type] ?? null };
}

const chatMapped = mapping({ serverId: '5', serverVersion: 1 });
const send = (operation: 'create' | 'import' | 'update' | 'delete', body: unknown = payload, baseVersion?: number) =>
  event({ entityType: 'chat-ticket-link', operation, payload: body, clientEntityId: LINK, ...(baseVersion !== undefined ? { baseVersion } : {}) });
const withTicket = () => ctx({ resolveTaskId: async () => 9 });

describe('importSyncedChatTicketLink', () => {
  it('is pending until the chat is mapped, and writes nothing', async () => {
    const db = dbOf();
    const outcome = await importSyncedChatTicketLink(send('create'), withTicket(), storesWith({}), db);
    expect(outcome).toEqual({ status: 'pending', detail: 'link_chat_pending' });
    expect(db.calls).toHaveLength(0);
  });

  it('is pending until the ticket resolves, and writes nothing', async () => {
    const db = dbOf();
    const outcome = await importSyncedChatTicketLink(send('create'), ctx({ resolveTaskId: async () => null }), storesWith({ chat: chatMapped }), db);
    expect(outcome).toEqual({ status: 'pending', detail: 'link_ticket_pending' });
    expect(db.calls).toHaveLength(0);
  });

  it('rejects a chat that is not the caller\'s own', async () => {
    const outcome = await importSyncedChatTicketLink(
      send('create'),
      ctx({ resolveTaskId: async () => 9, resolveOwnChatId: async () => null }),
      storesWith({ chat: chatMapped }),
      dbOf(),
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_chat_not_owned' });
  });

  it('upserts the link once both parents exist and maps the link row id', async () => {
    const afterCommit = vi.fn();
    const db = dbOf([[{ taskType: 'epic' }], [], [{ id: 55, linkType: 'linked' }]]);
    const outcome = await importSyncedChatTicketLink(send('import'), ctx({ resolveTaskId: async () => 9, afterCommit }), storesWith({ chat: chatMapped }), db);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('55');
    expect(outcome.serverVersion).toBe(1);
    expect(outcome.payload).toEqual({ chatId: '5', ticketId: '9', linkType: 'linked' });
    expect(outcome.destinationKey).toBe(boundKey);
    const insert = db.calls.find((call) => call.kind === 'insert');
    expect(insert?.payload).toMatchObject({ tenantId: 7, chatId: 5, ticketKind: 'epic', ticketRef: '9', linkType: 'linked' });
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it('replays an identical event without a write', async () => {
    const stored = { chatId: '5', ticketId: '9', linkType: 'linked' };
    const db = dbOf([[{ taskType: 'task' }]]);
    const outcome = await importSyncedChatTicketLink(
      send('create'),
      withTicket(),
      storesWith({ chat: chatMapped, 'chat-ticket-link': mapping({ serverId: '55', serverVersion: 1, payloadHash: hashSyncPayload(stored) }) }),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('55');
    expect(db.calls.filter((call) => call.kind === 'insert' || call.kind === 'update')).toHaveLength(0);
  });

  it('unlinks on a tombstone, and replays the tombstone without a second delete', async () => {
    const linkMapping = mapping({ serverId: '55', serverVersion: 1 });
    const db = dbOf([[{ chatId: 5, kind: 'task', ref: '9' }], [{ id: 55 }]]);
    const outcome = await importSyncedChatTicketLink(send('delete', null, 1), withTicket(), storesWith({ 'chat-ticket-link': linkMapping }), db);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverVersion).toBe(2);
    expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(1);

    const replayDb = dbOf();
    const tombstoned = mapping({ serverId: '55', serverVersion: 2, deletedAt: new Date('2026-10-01T00:00:00.000Z') });
    const replay = await importSyncedChatTicketLink(send('delete', null, 1), withTicket(), storesWith({ 'chat-ticket-link': tombstoned }), replayDb);
    expect(replay.status).toBe('applied');
    expect(replayDb.calls).toHaveLength(0);
  });

  it('rejects a delete that arrives with no payload for a link that was never imported', async () => {
    const outcome = await importSyncedChatTicketLink(send('delete', null, 1), withTicket(), storesWith({}), dbOf());
    expect(outcome).toEqual({ status: 'rejected', detail: 'entity_not_imported' });
  });
});

describe('importSyncedChatTicketLink: revive and server ids', () => {
  const tombstoned = mapping({ serverId: '55', serverVersion: 2, deletedAt: new Date('2026-10-01T00:00:00.000Z') });

  it('re-creating a pair the server unlinked writes the link again (create)', async () => {
    const db = dbOf([[{ taskType: 'task' }], [], [{ id: 77, linkType: 'linked' }]]);
    const outcome = await importSyncedChatTicketLink(send('create'), withTicket(), storesWith({ chat: chatMapped, 'chat-ticket-link': tombstoned }), db);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('77');
    expect(outcome.serverVersion).toBe(3);
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(true);
  });

  it('an update over the tombstone revives it instead of entity_deleted', async () => {
    const db = dbOf([[{ taskType: 'task' }], [], [{ id: 78, linkType: 'linked' }]]);
    const outcome = await importSyncedChatTicketLink(send('update', payload, 2), withTicket(), storesWith({ chat: chatMapped, 'chat-ticket-link': tombstoned }), db);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('78');
    expect(outcome.serverVersion).toBe(3);
  });

  it('applies a link whose chat and ticket exist only by server id', async () => {
    const db = dbOf([[{ taskType: 'task' }], [], [{ id: 90, linkType: 'linked' }]]);
    const resolveTaskId = vi.fn(async (reference: string) => (reference === '9' ? 9 : null));
    const outcome = await importSyncedChatTicketLink(
      send('create', { ...payload, chatServerId: '5', ticketServerId: '9' }),
      ctx({ resolveTaskId }),
      storesWith({}),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.payload).toEqual({ chatId: '5', ticketId: '9', linkType: 'linked' });
  });

  it('rejects a malformed server id', async () => {
    const outcome = await importSyncedChatTicketLink(send('create', { ...payload, ticketServerId: 'abc' }), withTicket(), storesWith({}), dbOf());
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_ticket_invalid' });
  });
});

describe('importSyncedChatTicketLink: server-origin links and guards', () => {
  it('unlink of an unmapped live link deletes it by pair and records a mapping', async () => {
    const db = dbOf([[{ taskType: 'task' }], [{ id: 61 }], [{ id: 61 }]]);
    const outcome = await importSyncedChatTicketLink(send('delete', payload, 1), withTicket(), storesWith({ chat: chatMapped }), db);
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('61');
    expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(1);
  });

  it('an unmapped unlink that finds no row records no mapping and no sentinel id', async () => {
    const db = dbOf([[{ taskType: 'task' }], []]);
    const outcome = await importSyncedChatTicketLink(send('delete', payload, 1), withTicket(), storesWith({ chat: chatMapped }), db);
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_not_found' });
    expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(0);
  });

  it('an update whose link row was removed on the server records the NEW row id, not the stale mapping id', async () => {
    const live = mapping({ serverId: '55', serverVersion: 1, payloadHash: hashSyncPayload({ chatId: '5', ticketId: '9', linkType: 'linked' }) });
    const db = dbOf([[{ taskType: 'task' }], [], [], [{ id: 99, linkType: 'created' }]]);
    const outcome = await importSyncedChatTicketLink(
      send('update', { ...payload, linkType: 'created' }, 1),
      withTicket(),
      storesWith({ chat: chatMapped, 'chat-ticket-link': live }),
      db,
    );
    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') return;
    expect(outcome.serverId).toBe('99');
    expect(outcome.serverVersion).toBe(2);
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(true);
  });

  it('refuses the unmapped unlink of a foreign chat', async () => {
    const db = dbOf();
    const outcome = await importSyncedChatTicketLink(
      send('delete', payload, 1),
      ctx({ resolveTaskId: async () => 9, resolveOwnChatId: async () => null }),
      storesWith({ chat: chatMapped }),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_chat_not_owned' });
    expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(0);
  });

  it('an unmapped update retypes the link through the idempotent upsert', async () => {
    const db = dbOf([[{ taskType: 'task' }], [{ id: 61, linkType: 'linked' }], [{ id: 61, linkType: 'created' }]]);
    const outcome = await importSyncedChatTicketLink(send('update', { ...payload, linkType: 'created' }, 1), withTicket(), storesWith({ chat: chatMapped }), db);
    expect(outcome.status).toBe('applied');
  });

  it('rejects an update that names a different pair than the stored link', async () => {
    const db = dbOf([[{ taskType: 'task' }], [{ chatId: 6, kind: 'task', ref: '9' }]]);
    const outcome = await importSyncedChatTicketLink(
      send('update', payload, 1),
      withTicket(),
      storesWith({ chat: chatMapped, 'chat-ticket-link': mapping({ serverId: '55', serverVersion: 1 }) }),
      db,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_pair_immutable' });
    expect(db.calls.filter((call) => call.kind === 'update' || call.kind === 'insert')).toHaveLength(0);
  });

  it('rejects a ticketServerId the tenant does not own instead of holding', async () => {
    const outcome = await importSyncedChatTicketLink(
      send('create', { ...payload, ticketServerId: '9' }),
      ctx({ resolveTaskId: async () => null }),
      storesWith({ chat: chatMapped }),
      dbOf(),
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'link_ticket_not_owned' });
  });

  describe('tiers other than task / epic / gap (resolved like POST /chats/:id/tickets)', () => {
    const SPEC = '55555555-5555-4555-8555-555555555555';
    const tier = (ticketKind: string) => ({ ...payload, ticketKind, ticketRef: SPEC });

    it.each(['spec', 'objective', 'roadmap'])('accepts a %s link and stores its (kind, ref)', async (kind) => {
      const db = dbOf([[{ label: 'A work item', status: 'open' }], [], [{ id: 77, linkType: 'linked' }]]);
      const outcome = await importSyncedChatTicketLink(send('create', tier(kind)), ctx({ resolveTaskId: async () => null }), storesWith({ chat: chatMapped }), db);
      expect(outcome.status).toBe('applied');
      if (outcome.status !== 'applied') return;
      expect(outcome.serverId).toBe('77');
      expect(outcome.payload).toEqual({ chatId: '5', ticketId: SPEC, linkType: 'linked' });
      expect(db.calls.find((call) => call.kind === 'insert')?.payload).toMatchObject({ chatId: 5, ticketKind: kind, ticketRef: SPEC });
    });

    it('refuses an unknown or foreign ref, and writes nothing', async () => {
      const db = dbOf([[]]);
      const outcome = await importSyncedChatTicketLink(send('create', tier('spec')), ctx({ resolveTaskId: async () => null }), storesWith({ chat: chatMapped }), db);
      expect(outcome).toEqual({ status: 'rejected', detail: 'link_ticket_not_owned' });
      expect(db.calls.filter((call) => call.kind === 'insert' || call.kind === 'update')).toHaveLength(0);
    });

    it('refuses a payload naming a kind without a ref, or an unknown kind', async () => {
      for (const body of [{ ...payload, ticketKind: 'spec' }, { ...payload, ticketKind: 'bogus', ticketRef: SPEC }]) {
        const outcome = await importSyncedChatTicketLink(send('create', body), withTicket(), storesWith({ chat: chatMapped }), dbOf());
        expect(outcome).toEqual({ status: 'rejected', detail: 'link_ticket_invalid' });
      }
    });

    it('unlinks a mapped spec link by its stored (kind, ref)', async () => {
      const db = dbOf([[{ chatId: 5, kind: 'spec', ref: SPEC }], [{ id: 55 }]]);
      const outcome = await importSyncedChatTicketLink(send('delete', null, 1), withTicket(), storesWith({ 'chat-ticket-link': mapping({ serverId: '55', serverVersion: 1 }) }), db);
      expect(outcome.status).toBe('applied');
      if (outcome.status !== 'applied') return;
      expect(outcome.serverVersion).toBe(2);
      expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(1);
    });

    it('unlinks an unmapped objective link by pair, and settles an absent one as link_not_found', async () => {
      const db = dbOf([[{ label: 'An objective', status: 'open' }], [{ id: 61 }], [{ id: 61 }]]);
      const outcome = await importSyncedChatTicketLink(send('delete', tier('objective'), 1), ctx({ resolveTaskId: async () => null }), storesWith({ chat: chatMapped }), db);
      expect(outcome.status).toBe('applied');
      if (outcome.status !== 'applied') return;
      expect(outcome.serverId).toBe('61');
      expect(db.calls.filter((call) => call.kind === 'delete')).toHaveLength(1);

      const goneDb = dbOf([[{ label: 'An objective', status: 'open' }], []]);
      const gone = await importSyncedChatTicketLink(send('delete', tier('objective'), 1), ctx({ resolveTaskId: async () => null }), storesWith({ chat: chatMapped }), goneDb);
      expect(gone).toEqual({ status: 'rejected', detail: 'link_not_found' });
      expect(goneDb.calls.filter((call) => call.kind === 'delete')).toHaveLength(0);
    });

    it('is pending until the chat is mapped, before resolving the ticket', async () => {
      const db = dbOf();
      const outcome = await importSyncedChatTicketLink(send('create', tier('spec')), ctx({ resolveTaskId: async () => null }), storesWith({}), db);
      expect(outcome).toEqual({ status: 'pending', detail: 'link_chat_pending' });
      expect(db.calls).toHaveLength(0);
    });

    it.each([
      ['another tier', { chatId: 5, kind: 'objective', ref: SPEC }],
      ['another ref', { chatId: 5, kind: 'spec', ref: '66666666-6666-4666-8666-666666666666' }],
    ])('rejects an update whose stored link is on %s as link_pair_immutable', async (_label, stored) => {
      const db = dbOf([[{ label: 'A spec', status: 'open' }], [stored]]);
      const outcome = await importSyncedChatTicketLink(
        send('update', tier('spec'), 1),
        ctx({ resolveTaskId: async () => null }),
        storesWith({ chat: chatMapped, 'chat-ticket-link': mapping({ serverId: '55', serverVersion: 1 }) }),
        db,
      );
      expect(outcome).toEqual({ status: 'rejected', detail: 'link_pair_immutable' });
      expect(db.calls.filter((call) => call.kind === 'update' || call.kind === 'insert')).toHaveLength(0);
    });
  });

  it('stamps the tenant segment on a new link', async () => {
    const db = dbOf([[{ taskType: 'task' }], [], [{ id: 70, linkType: 'linked' }]]);
    await importSyncedChatTicketLink(send('create'), withTicket(), storesWith({ chat: chatMapped }), db);
    expect(db.calls.find((call) => call.kind === 'insert')?.payload).toMatchObject({ segmentId: 'seg-1' });
  });
});
