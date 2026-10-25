import { describe, expect, it, vi } from 'vitest';

vi.mock('../../brain/chatCacheVersions', () => ({ bumpChatMessages: async () => undefined }));

import { hashSyncPayload, type LocalEntityType } from '../../../domain/sync/syncProtocol';
import type { RecordUsageRow } from '../../llm/usageLedger';
import type { SyncEntityMappingRow, SyncStoreSet, SyncUsageLedger } from '../syncPorts';
import { boundKey, ctx, dbOf, event, mapping, now, stores } from './__fixtures__/importerHarness';
import { importSyncedChat } from './importSyncedChat';
import { importSyncedMessage } from './importSyncedMessage';
import { importSyncedUsage } from './importSyncedUsage';

const CHAT_CLIENT_ID = '22222222-2222-4222-8222-222222222222';

const chatValue = {
  clientId: '11111111-1111-4111-8111-111111111111',
  chat: {
    id: 3,
    title: '  Fix the login bug  ',
    projectId: 9,
    origin: 'local',
    mode: 'work',
    capability: null,
    originalRequest: 'the login button does nothing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
};

const messageValue = {
  clientId: '11111111-1111-4111-8111-111111111111',
  chatId: 3,
  chatClientId: CHAT_CLIENT_ID,
  eventKey: 'message:abc',
  message: { id: 4, role: 'user', content: 'hello', metadata: null, seq: 1, createdAt: '2026-10-01T00:00:00.000Z' },
};

/** A store set whose mappings are keyed by entity type (the chat parent vs the row itself). */
function storesWith(byType: Partial<Record<LocalEntityType, SyncEntityMappingRow>>): SyncStoreSet & { writes: string[] } {
  const book = stores();
  book.findMapping = async (_tenantId, entityType) => byType[entityType] ?? null;
  return book;
}

describe('importSyncedChat', () => {
  it('inserts the caller’s chat in the web Brain’s origin and stores the payload verbatim', async () => {
    const db = dbOf([[{ id: 21 }]]);
    const outcome = await importSyncedChat(event({ entityType: 'chat', operation: 'import', payload: chatValue }), ctx(), stores(), db);
    expect(outcome).toMatchObject({ status: 'applied', serverId: '21', serverVersion: 1, destinationKey: boundKey, payload: chatValue });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.kind).toBe('insert');
    expect(db.calls[0]?.payload).toMatchObject({
      tenantId: 7,
      userId: 'user-1',
      origin: 'brainstorm',
      projectId: 3, // resolved through the context, never trusted verbatim
      title: 'Fix the login bug',
      mode: 'work',
      originalRequest: 'the login button does nothing',
      isArchived: false,
    });
  });

  it('keeps the chat when its project does not resolve — the project is dropped, not the import', async () => {
    const db = dbOf([[{ id: 21 }]]);
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: chatValue }),
      ctx({ resolveProjectId: async () => null }),
      stores(),
      db,
    );
    expect(outcome.status).toBe('applied');
    expect(db.calls[0]?.payload).toMatchObject({ projectId: null });
  });

  it('adopts the chat bound on sign-in instead of minting a second one, and strips the hint', async () => {
    const db = dbOf([[{ id: 40 }]]);
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: { ...chatValue, serverId: 40 } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '40', payload: chatValue });
    if (outcome.status === 'applied') expect(outcome.payloadHash).toBe(hashSyncPayload(chatValue));
    expect(db.calls.map((call) => call.kind)).toEqual(['select']);
  });

  it('ignores a hint that is not the caller’s own chat', async () => {
    const db = dbOf([[], [{ id: 22 }]]);
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: { ...chatValue, serverId: 99 } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '22' });
    expect(db.calls.map((call) => call.kind)).toEqual(['select', 'insert']);
  });

  it('answers a retried import from its mapping without writing', async () => {
    const db = dbOf();
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: { ...chatValue, serverId: 40 } }),
      ctx(),
      stores(mapping({ serverId: '40', serverVersion: 1, payloadHash: hashSyncPayload(chatValue) })),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '40', serverVersion: 1 });
    expect(db.calls).toHaveLength(0);
  });

  it('updates title/archive on the current base version and archives on delete', async () => {
    const renamed = { ...chatValue, chat: { ...chatValue.chat, title: 'Renamed' } };
    const update = dbOf([[{ id: 42 }]]);
    const updated = await importSyncedChat(
      event({ entityType: 'chat', operation: 'update', payload: renamed, baseVersion: 2 }),
      ctx(),
      stores(mapping()),
      update,
    );
    expect(updated).toMatchObject({ status: 'applied', serverId: '42', serverVersion: 3 });
    expect(update.calls[0]?.payload).toMatchObject({ title: 'Renamed', isArchived: false });

    const remove = dbOf([[{ id: 42 }]]);
    const deleted = await importSyncedChat(
      event({ entityType: 'chat', operation: 'delete', payload: renamed, baseVersion: 2 }),
      ctx(),
      stores(mapping()),
      remove,
    );
    expect(deleted).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(remove.calls[0]?.kind).toBe('update');
    expect(remove.calls[0]?.payload).toMatchObject({ isArchived: true });
  });

  it('refuses a stale base version as a conflict', async () => {
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'update', payload: chatValue, baseVersion: 1 }),
      ctx(),
      stores(mapping()),
      dbOf(),
    );
    expect(outcome).toMatchObject({ status: 'conflict', detail: 'base_version_conflict' });
  });
});

describe('importSyncedMessage', () => {
  it('writes a history row on the mapped server chat, at the client’s time', async () => {
    const db = dbOf([[{ id: 77 }]]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '77', serverVersion: 1, payload: messageValue });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.payload).toMatchObject({
      chatId: 42,
      role: 'user',
      content: 'hello',
      eventKey: 'message:abc',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('holds a message whose chat has not landed — pending, nothing written', async () => {
    const db = dbOf();
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx(),
      storesWith({}),
      db,
    );
    expect(outcome).toEqual({ status: 'pending', detail: 'message_chat_pending' });
    expect(db.calls).toHaveLength(0);
  });

  it('adopts the row already on the chat under the same event key', async () => {
    const db = dbOf([[], [{ id: 55 }]]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '55' });
  });

  it('clamps a client clock that runs ahead', async () => {
    const ahead = { ...messageValue, message: { ...messageValue.message, createdAt: '2099-01-01T00:00:00.000Z' } };
    const db = dbOf([[{ id: 77 }]]);
    await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: ahead }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
    );
    expect(db.calls[0]?.payload).toMatchObject({ createdAt: now });
  });

  it('rewrites only the metadata on a feedback update', async () => {
    const rated = { ...messageValue, message: { ...messageValue.message, metadata: '{"feedback":"up"}' } };
    const db = dbOf([[{ id: 77 }]]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'update', payload: rated, baseVersion: 2 }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }), message: mapping({ serverId: '77' }) }),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(db.calls[0]?.kind).toBe('update');
    expect(db.calls[0]?.payload).toEqual({ metadata: '{"feedback":"up"}' });
  });

  it('rejects an unknown role', async () => {
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: { ...messageValue, message: { ...messageValue.message, role: 'root' } } }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      dbOf(),
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'message_role_invalid' });
  });
});

describe('importSyncedUsage', () => {
  const localCall = {
    clientEventId: '33333333-3333-4333-8333-333333333333',
    clientChatId: CHAT_CLIENT_ID,
    runKey: 3,
    model: 'local/ollama/qwen3:8b',
    route: 'local',
    mode: 'work',
    promptTokens: 1200,
    completionTokens: 300,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    savingsSource: 'local_model',
    savedPrompt: 1200,
    savedCompletion: 300,
    savedCostMc: 840,
    at: '2026-10-01T00:00:00.000Z',
  };

  function ledger(existing = false): SyncUsageLedger & { rows: RecordUsageRow[]; keys: string[] } {
    const rows: RecordUsageRow[] = [];
    const keys: string[] = [];
    return {
      rows,
      keys,
      hasRow: async (_tenantId, key) => {
        keys.push(key);
        return existing;
      },
      record: async (row) => {
        rows.push(row);
      },
    };
  }

  it('writes one own-machine row with the client-priced local saving, attributed to the chat', async () => {
    const usage = ledger();
    const outcome = await importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: localCall }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      usage,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 1, payload: localCall });
    expect(usage.keys).toEqual([`sync-usage:${localCall.clientEventId}`]);
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      tenantId: 7,
      model: 'local/ollama/qwen3:8b',
      surface: 'vsix',
      byo: true,
      byoProvider: null,
      calls: 1,
      idempotencyKey: `sync-usage:${localCall.clientEventId}`,
      metadata: { chatId: 42, mode: 'work', clientEventId: localCall.clientEventId, source: 'client-reported' },
      usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
      savings: { source: 'local_model', savedPromptTokens: 1200, savedCompletionTokens: 300, estimated: true },
      savedCostMillicents: 840,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('never imports a gateway call — the gateway already logged it', async () => {
    const usage = ledger();
    const outcome = await importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: { ...localCall, route: 'gateway' } }),
      ctx(),
      storesWith({}),
      usage,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'usage_server_observed' });
    expect(usage.rows).toHaveLength(0);
  });

  it('does not write twice when the usage row already exists (a retry after a lost receipt)', async () => {
    const usage = ledger(true);
    const outcome = await importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: localCall }),
      ctx(),
      storesWith({}),
      usage,
    );
    expect(outcome.status).toBe('applied');
    expect(usage.rows).toHaveLength(0);
  });

  it('records a direct-provider call as the person’s own key, unattributed when its chat is unmapped', async () => {
    const usage = ledger();
    const direct = { ...localCall, model: 'direct/minimax/MiniMax-M2.7', route: 'byo-direct', savingsSource: undefined };
    await importSyncedUsage(event({ entityType: 'usage', operation: 'import', payload: direct }), ctx(), storesWith({}), usage);
    expect(usage.rows[0]).toMatchObject({ byo: true, byoProvider: 'minimax' });
    expect(usage.rows[0]?.metadata).not.toHaveProperty('chatId');
    expect(usage.rows[0]).not.toHaveProperty('savings');
  });

  it('is immutable', async () => {
    const outcome = await importSyncedUsage(
      event({ entityType: 'usage', operation: 'update', payload: localCall, baseVersion: 1 }),
      ctx(),
      storesWith({}),
      ledger(),
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'usage_immutable' });
  });
});
