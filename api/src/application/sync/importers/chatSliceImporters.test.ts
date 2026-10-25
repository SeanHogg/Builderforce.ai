import { describe, expect, it, vi } from 'vitest';

vi.mock('../../brain/chatCacheVersions', () => ({ bumpChatMessages: async () => undefined }));

import { hashSyncPayload, type LocalEntityType } from '../../../domain/sync/syncProtocol';
import type { RecordUsageRow } from '../../llm/usageLedger';
import type { SyncEntityMappingRow, SyncStepStore, SyncStoreSet, SyncUsageLedger } from '../syncPorts';
import { boundKey, ctx, dbOf, event, mapping, now, stores } from './__fixtures__/importerHarness';
import { importSyncedChat } from './importSyncedChat';
import { importSyncedMessage } from './importSyncedMessage';
import { importSyncedUsage } from './importSyncedUsage';

/** A step store that records what it was asked to write (ids from the operational floor). */
function stepStore(): SyncStepStore & { appended: Array<{ chatId: number; eventKey: string | null; metadata: string }> } {
  const appended: Array<{ chatId: number; eventKey: string | null; metadata: string }> = [];
  return {
    appended,
    async append(_tenantId, chatId, step) { appended.push({ chatId, eventKey: step.eventKey, metadata: step.metadata }); return 1_000_000_000_000 + appended.length; },
    async chatOf() { return null; },
    async update() { return null; },
    async remove() {},
  };
}

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
    const db = dbOf();
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: { ...chatValue, serverId: 40 } }),
      ctx(),
      stores(),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '40', payload: chatValue });
    if (outcome.status === 'applied') expect(outcome.payloadHash).toBe(hashSyncPayload(chatValue));
    expect(db.calls).toHaveLength(0);
  });

  it('ignores a hint that is not the caller’s own chat', async () => {
    const db = dbOf([[{ id: 22 }]]);
    const outcome = await importSyncedChat(
      event({ entityType: 'chat', operation: 'import', payload: { ...chatValue, serverId: 99 } }),
      ctx({ resolveOwnChatId: async () => null }),
      stores(),
      db,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '22' });
    expect(db.calls.map((call) => call.kind)).toEqual(['insert']);
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
  const steps = stepStore();

  it('writes a history row on the mapped server chat, at the client’s time', async () => {
    const db = dbOf([[{ id: 77 }]]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
      steps,
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
      steps,
    );
    expect(outcome).toEqual({ status: 'pending', detail: 'message_chat_pending' });
    expect(db.calls).toHaveLength(0);
  });

  it('refuses a message whose mapped chat is another member’s — nothing is written into it', async () => {
    const db = dbOf();
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx({ resolveOwnChatId: async () => null }),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
      steps,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'message_chat_not_owned' });
    expect(db.calls).toHaveLength(0);
  });

  it('adopts the row already on the chat under the same event key', async () => {
    const db = dbOf([[], [{ id: 55 }]]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: messageValue }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
      steps,
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
      steps,
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
      steps,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(db.calls[0]?.kind).toBe('update');
    expect(db.calls[0]?.payload).toEqual({ metadata: '{"feedback":"up"}' });
  });

  it('deletes a message from its tombstone alone, on the caller’s own chat', async () => {
    const db = dbOf([[{ chatId: 42 }], []]);
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'delete', payload: null, baseVersion: 2 }),
      ctx(),
      storesWith({ message: mapping({ serverId: '77' }) }),
      db,
      steps,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverVersion: 3 });
    expect(db.calls.map((call) => call.kind)).toEqual(['select', 'delete']);
  });

  it('sends a run STEP to the step store, never into the transcript transaction', async () => {
    const book = stepStore();
    const db = dbOf();
    const step = { ...messageValue, eventKey: 'step:1', message: { ...messageValue.message, role: 'tool', content: '', metadata: '{"kind":"step","category":"tool","label":"read_file"}' } };
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: step }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      db,
      book,
    );
    expect(outcome).toMatchObject({ status: 'applied', serverId: '1000000000001' });
    expect(db.calls).toHaveLength(0);
    expect(book.appended).toEqual([{ chatId: 42, eventKey: 'step:1', metadata: step.message.metadata }]);
  });

  it('rejects an unknown role', async () => {
    const outcome = await importSyncedMessage(
      event({ entityType: 'message', operation: 'import', payload: { ...messageValue, message: { ...messageValue.message, role: 'root' } } }),
      ctx(),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      dbOf(),
      steps,
    );
    expect(outcome).toEqual({ status: 'rejected', detail: 'message_role_invalid' });
  });
});

describe('importSyncedUsage', () => {
  const localCall = {
    // The event's own entity id (the harness default) — the ledger key is derived from it.
    clientEventId: '11111111-1111-4111-8111-111111111111',
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

  /** The ledger port's contract: one row per idempotency key, and a failed write throws. */
  function ledger(options: { fail?: boolean } = {}): SyncUsageLedger & { rows: RecordUsageRow[]; keys: string[] } {
    const rows: RecordUsageRow[] = [];
    const keys: string[] = [];
    return {
      rows,
      keys,
      record: async (row) => {
        if (options.fail) throw new Error('usage database unavailable');
        if (keys.includes(row.idempotencyKey ?? '')) return;
        keys.push(row.idempotencyKey ?? '');
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

  it('does not write twice when the receipt was lost and the push is retried', async () => {
    const usage = ledger();
    const retry = () => importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: localCall }),
      ctx(),
      storesWith({}),
      usage,
    );
    expect((await retry()).status).toBe('applied');
    expect((await retry()).status).toBe('applied');
    expect(usage.rows).toHaveLength(1);
  });

  it('answers a failed write as pending — retried, never applied and lost', async () => {
    const outcome = await importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: localCall }),
      ctx(),
      storesWith({}),
      ledger({ fail: true }),
    );
    expect(outcome).toEqual({ status: 'pending', detail: 'usage_write_failed' });
  });

  it('never attributes a call to a chat that is not the caller’s own', async () => {
    const usage = ledger();
    await importSyncedUsage(
      event({ entityType: 'usage', operation: 'import', payload: localCall }),
      ctx({ resolveOwnChatId: async () => null }),
      storesWith({ chat: mapping({ serverId: '42' }) }),
      usage,
    );
    expect(usage.rows[0]?.metadata).not.toHaveProperty('chatId');
  });

  it('records a direct-provider call as the person’s own key, unattributed when its chat is unmapped', async () => {
    const usage = ledger();
    const direct = { ...localCall, model: 'direct/minimax/MiniMax-M2.7', route: 'byo-direct', savingsSource: undefined };
    await importSyncedUsage(event({ entityType: 'usage', operation: 'import', payload: direct }), ctx(), storesWith({}), usage);
    expect(usage.rows[0]).toMatchObject({ byo: true, byoProvider: 'minimax' });
    expect(usage.rows[0]?.metadata).not.toHaveProperty('chatId');
    expect(usage.rows[0]).not.toHaveProperty('savings');
  });

  it('refuses a payload that names another event, or a token count no call reports', async () => {
    for (const [payload, detail] of [
      [{ ...localCall, clientEventId: '44444444-4444-4444-8444-444444444444' }, 'usage_event_id_mismatch'],
      [{ ...localCall, promptTokens: 1e12 }, 'usage_tokens_out_of_range'],
    ] as const) {
      const usage = ledger();
      const outcome = await importSyncedUsage(event({ entityType: 'usage', operation: 'import', payload }), ctx(), storesWith({}), usage);
      expect(outcome).toEqual({ status: 'rejected', detail });
      expect(usage.rows).toHaveLength(0);
    }
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
