import { describe, expect, it } from 'vitest';
import {
  CLIENT_REPORTED_EVIDENCE,
  FactChatIsolationError,
  FactChatSyncError,
  applyLocalSync,
  assertFactNotWrittenAsChatMessage,
  assertProvenance,
  assertSyncDoesNotCrossFactAndChat,
  createFactStore,
  factContentHash,
  factJournalIsSeparate,
  isClientReported,
  refuseFactOnChatSync,
  rejectMissingProvenance,
  serverOverwritesClientReported,
  type ChatSyncBatch,
  type FactProvenance,
  type RememberFactInput,
} from './factProvenance.js';
import { createMemoryLocalFirstStore, newLocalRecord } from './store.js';

const DEVICE = 'device-1';

function provenance(over: Partial<FactProvenance> = {}): FactProvenance {
  return {
    deviceId: DEVICE,
    clientId: 'fact-client',
    source: 'local',
    recordedAt: '2026-10-19T00:00:00.000Z',
    factVersion: 1,
    occurredAt: '2026-10-19T00:00:00.000Z',
    contentHash: 'fnv1a:00000000',
    sourceRunId: 'run-1',
    ...over,
  };
}

describe('memory fact provenance', () => {
  it('persists a versioned fact with device provenance, apart from chat events', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    const saved = await facts.remember({
      id: 'fact-1',
      key: 'chat-list-source',
      statement: 'The chat list reads the local store.',
      deviceId: DEVICE,
      actorId: 'user-1',
      sourceRunId: 'run-9',
      policyVersion: 'policy-3',
      occurredAt: '2026-10-19T00:00:00.000Z',
    });

    expect(saved.version).toBe(1);
    expect(saved.provenance).toEqual({
      deviceId: DEVICE,
      actorId: 'user-1',
      source: 'local',
      policyVersion: 'policy-3',
      recordedAt: '2026-10-19T00:00:00.000Z',
      factVersion: 1,
      sourceRunId: 'run-9',
      clientId: 'fact-1',
      occurredAt: '2026-10-19T00:00:00.000Z',
      contentHash: factContentHash({
        key: 'chat-list-source',
        statement: 'The chat list reads the local store.',
      }),
    });
    expect(saved).not.toHaveProperty('chatId');

    const snapshot = await store.export();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.entityType).toBe('memory-fact');
    expect(factJournalIsSeparate(snapshot.events[0]!)).toBe(true);
    expect(snapshot.events.some((event) => event.entityType === 'chat' || event.entityType === 'message')).toBe(false);
    expect(await facts.recall('fact-1')).toEqual(saved);
  });

  it('bumps the fact version and refuses a stale expected version', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    await facts.remember({ id: 'fact-2', key: 'k', statement: 'first', deviceId: DEVICE, sourceRunId: 'run-2' });
    const second = await facts.remember({
      id: 'fact-2',
      key: 'k',
      statement: 'second',
      deviceId: DEVICE,
      expectedVersion: 1,
    });
    expect(second.version).toBe(2);
    expect(second.provenance.factVersion).toBe(2);
    await expect(facts.remember({
      id: 'fact-2',
      key: 'k',
      statement: 'stale',
      deviceId: DEVICE,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'FACT_VERSION_CONFLICT' });
  });

  it('rejects a fact with no device, and recall does not invent one', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    await expect(facts.remember({ id: 'fact-3', key: 'k', statement: 's', deviceId: '  ' }))
      .rejects.toThrow('fact_device_required');
    expect(await facts.recall('missing')).toBeUndefined();
  });
});

describe('fact provenance enforcement', () => {
  it('throws missing_provenance on a fact with no provenance', () => {
    expect(() => assertProvenance({ provenance: undefined })).toThrow('missing_provenance');
    expect(() => assertProvenance({ provenance: undefined }))
      .toThrow(expect.objectContaining({ code: 'MISSING_PROVENANCE' }));
  });

  it('throws missing_provenance when provenance has no device, rather than repairing one', () => {
    expect(() => assertProvenance({
      provenance: {
        deviceId: '   ',
        source: 'local',
        recordedAt: '',
        factVersion: 1,
        occurredAt: '',
        contentHash: 'fnv1a:00000000',
      },
    })).toThrow('missing_provenance');
  });

  it('accepts a provenance-bearing record and returns undefined', () => {
    expect(assertProvenance({ provenance: provenance() })).toBeUndefined();
  });

  it('labels a fact client-reported exactly when its evidence says so', () => {
    expect(isClientReported({ provenance: provenance({ evidence: CLIENT_REPORTED_EVIDENCE }) })).toBe(true);
    expect(isClientReported({ provenance: provenance({ evidence: 'server-observed' }) })).toBe(false);
    expect(isClientReported({ provenance: provenance() })).toBe(false);
    expect(isClientReported({ provenance: undefined })).toBe(false);
    expect(CLIENT_REPORTED_EVIDENCE).toBe('client-reported');
  });

  it('never lets one client claim silently overwrite another', () => {
    const clientClaim = provenance({ evidence: CLIENT_REPORTED_EVIDENCE, actorId: 'user-1' });
    expect(serverOverwritesClientReported(
      { provenance: clientClaim },
      { provenance: provenance({ evidence: CLIENT_REPORTED_EVIDENCE, actorId: 'user-2' }) },
    )).toBe(false);
  });

  it('refuses to promote a client claim from an incoming fact with no actor', () => {
    expect(serverOverwritesClientReported(
      { provenance: provenance({ evidence: CLIENT_REPORTED_EVIDENCE }) },
      { provenance: provenance({ actorId: '   ' }) },
    )).toBe(false);
    expect(serverOverwritesClientReported(
      { provenance: provenance({ evidence: CLIENT_REPORTED_EVIDENCE }) },
      { provenance: provenance() },
    )).toBe(false);
  });

  it('accepts a platform-observed incoming fact that names an actor', () => {
    expect(serverOverwritesClientReported(
      { provenance: provenance({ evidence: CLIENT_REPORTED_EVIDENCE }) },
      { provenance: provenance({ source: 'imported', evidence: 'server-observed', actorId: 'server' }) },
    )).toBe(true);
  });

  it('leaves a non-client-reported existing fact alone (the guard only guards claims)', () => {
    expect(serverOverwritesClientReported(
      { provenance: provenance({ evidence: 'server-observed', actorId: 'server' }) },
      { provenance: provenance({ evidence: 'server-observed', actorId: 'server-2' }) },
    )).toBe(true);
  });

  it('carries the evidence label on a stored client-reported fact', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    const saved = await facts.remember({
      id: 'fact-cr',
      key: 'chat-list-source',
      statement: 'Reported by a client.',
      deviceId: DEVICE,
      actorId: 'user-1',
      sourceRunId: 'run-cr',
    });
    // A locally written fact is not client-reported unless a sync labels it so.
    expect(isClientReported(saved)).toBe(false);
    assertProvenance(saved);
  });
});

describe('G20 fact store', () => {
  const occurredAt = '2026-10-19T12:00:00.000Z';

  it('records source run, device, occurredAt, and a content hash', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    const saved = await facts.remember({
      id: 'fact-prov',
      key: 'offline-default',
      statement: 'Sync stays off until Connect.',
      deviceId: DEVICE,
      sourceRunId: 'run-20',
      occurredAt,
    });

    expect(saved.provenance.deviceId).toBe(DEVICE);
    expect(saved.provenance.sourceRunId).toBe('run-20');
    expect(saved.provenance.occurredAt).toBe(occurredAt);
    expect(saved.provenance.contentHash).toBe(factContentHash({
      key: 'offline-default',
      statement: 'Sync stays off until Connect.',
    }));
    expect(saved.provenance.contentHash).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(saved).not.toHaveProperty('chatId');
  });

  it('lists facts for one device and not another', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    await facts.remember({
      id: 'fact-a',
      key: 'a',
      statement: 'on device a',
      deviceId: 'device-a',
      sourceRunId: 'run-a',
      occurredAt,
    });
    await facts.remember({
      id: 'fact-b',
      key: 'b',
      statement: 'on device b',
      deviceId: 'device-b',
      sourceRunId: 'run-b',
      occurredAt,
    });

    const listed = await facts.listForDevice('device-a');
    expect(listed.map((fact) => fact.id)).toEqual(['fact-a']);
    expect(listed[0]?.provenance.deviceId).toBe('device-a');
    await expect(facts.listForDevice('  ')).rejects.toThrow('fact_device_required');
  });

  it('does not write a fact as a chat message and refuses chat-sync enqueue', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    await expect(facts.remember({
      id: 'fact-chat',
      key: 'k',
      statement: 'must not become a message',
      deviceId: DEVICE,
      chatId: 'chat-9',
    } as RememberFactInput & { chatId: string })).rejects.toMatchObject({ code: 'FACT_WRITTEN_AS_CHAT_MESSAGE' });
    expect(() => assertFactNotWrittenAsChatMessage('message')).toThrow('fact_written_as_chat_message');

    const saved = await facts.remember({
      id: 'fact-local',
      key: 'k',
      statement: 'stays a fact',
      deviceId: DEVICE,
      sourceRunId: 'run-local',
      occurredAt,
    });
    const snapshot = await store.export();
    expect(snapshot.records.every((record) => record.entityType !== 'message' && record.entityType !== 'chat')).toBe(true);
    expect(snapshot.records.map((record) => record.entityType)).toEqual(['memory-fact']);
    expect(saved).not.toHaveProperty('chatId');

    const batch: ChatSyncBatch = {
      chatId: 'chat-9',
      messages: [{ id: 'msg-1', chatId: 'chat-9', entityType: 'message' }],
    };
    const before = batch.messages.length;
    const refusal = refuseFactOnChatSync(saved, batch);
    expect(batch.messages).toHaveLength(before);
    expect(batch.messages.some((message) => message.id === saved.id)).toBe(false);
    expect(refusal.ok).toBe(false);
    expect(refusal.code).toBe('FACT_CHAT_SYNC_REFUSED');
    expect(refusal.error).toBeInstanceOf(FactChatSyncError);
    expect(refusal.error.code).toBe('FACT_CHAT_SYNC_REFUSED');
    expect(refusal.error.refusedChatId).toBe('chat-9');
    expect(refusal.disconnected).toEqual({
      id: saved.id,
      entityType: 'memory-fact',
      deviceId: DEVICE,
      occurredAt,
      contentHash: saved.provenance.contentHash,
      sourceRunId: 'run-local',
    });
    expect(refusal.disconnected).not.toHaveProperty('chatId');
  });
});

describe('G20 provenance contract', () => {
  const occurredAt = '2026-10-19T12:00:00.000Z';

  it('creates a fact from a message id with client id, occurredAt, and content hash', async () => {
    const facts = createFactStore(createMemoryLocalFirstStore());
    const saved = await facts.remember({
      id: 'fact-from-message',
      key: 'k',
      statement: 'from a turn',
      deviceId: DEVICE,
      clientId: 'client-9',
      sourceMessageId: 'msg-9',
      occurredAt,
    });

    expect(saved.provenance.clientId).toBe('client-9');
    expect(saved.provenance.sourceMessageId).toBe('msg-9');
    expect(saved.provenance.sourceRunId).toBeUndefined();
    expect(saved.provenance.occurredAt).toBe(occurredAt);
    expect(saved.provenance.contentHash).toBe(factContentHash({ key: 'k', statement: 'from a turn' }));
    expect(saved).not.toHaveProperty('chatId');
    expect(await facts.recall('fact-from-message')).toEqual(saved);
  });

  it('rejects a fact with missing provenance and writes nothing', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    await expect(facts.remember({
      id: 'fact-bare',
      key: 'k',
      statement: 'no source',
      deviceId: DEVICE,
      clientId: 'client-1',
      occurredAt,
    })).rejects.toMatchObject({ code: 'MISSING_PROVENANCE' });
    await expect(facts.remember({
      id: 'fact-blank-source',
      key: 'k',
      statement: 'blank source',
      deviceId: DEVICE,
      sourceRunId: '  ',
      sourceMessageId: '',
      occurredAt,
    })).rejects.toMatchObject({ code: 'MISSING_PROVENANCE' });
    await expect(facts.remember({
      id: '   ',
      key: 'k',
      statement: 'no client',
      deviceId: DEVICE,
      occurredAt,
      sourceRunId: 'run-1',
    })).rejects.toMatchObject({ code: 'MISSING_PROVENANCE' });
    expect((await store.export()).records).toHaveLength(0);
    expect((await store.export()).events).toHaveLength(0);

    expect(() => rejectMissingProvenance(undefined)).toThrow('missing_provenance');
    expect(() => rejectMissingProvenance(provenance({ clientId: '  ' }))).toThrow('missing_provenance');
    expect(() => rejectMissingProvenance(provenance({ occurredAt: '' }))).toThrow('missing_provenance');
    expect(() => rejectMissingProvenance(provenance({ contentHash: '' }))).toThrow('missing_provenance');
    expect(() => rejectMissingProvenance(provenance({ sourceRunId: undefined, sourceMessageId: undefined })))
      .toThrow(expect.objectContaining({ code: 'MISSING_PROVENANCE' }));
  });

  it('does not let a chat sync overwrite a fact or a fact sync overwrite a chat that share an id', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    const saved = await facts.remember({
      id: 'shared-fact',
      key: 'k',
      statement: 'stays a fact',
      deviceId: DEVICE,
      sourceRunId: 'run-shared',
      occurredAt,
    });

    const incomingMessage = newLocalRecord({
      id: 'shared-fact',
      entityType: 'message',
      payload: { body: 'must not replace the fact' },
      deviceId: DEVICE,
      occurredAt,
    });
    await expect(applyLocalSync(store, incomingMessage)).rejects.toBeInstanceOf(FactChatIsolationError);
    await expect(facts.applySync(incomingMessage)).rejects.toMatchObject({
      code: 'FACT_CHAT_ENTITY_ISOLATION',
      entityId: 'shared-fact',
      existingType: 'memory-fact',
      incomingType: 'message',
    });
    expect(await facts.recall('shared-fact')).toEqual(saved);
    expect(await store.read((tx) => tx.get('message', 'shared-fact'))).toBeUndefined();

    const chat = newLocalRecord({
      id: 'shared-chat',
      entityType: 'chat',
      payload: { title: 'keep this chat' },
      deviceId: DEVICE,
      occurredAt,
    });
    await store.transact((tx) => tx.put(chat));
    await expect(facts.remember({
      id: 'shared-chat',
      key: 'k',
      statement: 'must not replace the chat',
      deviceId: DEVICE,
      sourceRunId: 'run-cross',
      occurredAt,
    })).rejects.toMatchObject({
      code: 'FACT_CHAT_ENTITY_ISOLATION',
      existingType: 'chat',
      incomingType: 'memory-fact',
    });
    const factOverChat = newLocalRecord({
      id: 'shared-chat',
      entityType: 'memory-fact',
      payload: {
        key: 'k',
        statement: 'must not replace the chat',
        clientId: 'shared-chat',
        sourceRunId: 'run-cross',
        occurredAt,
        contentHash: factContentHash({ key: 'k', statement: 'must not replace the chat' }),
      },
      deviceId: DEVICE,
      occurredAt,
    });
    await expect(applyLocalSync(store, factOverChat)).rejects.toMatchObject({
      code: 'FACT_CHAT_ENTITY_ISOLATION',
      existingType: 'chat',
      incomingType: 'memory-fact',
    });
    expect(await store.read((tx) => tx.get('chat', 'shared-chat'))).toMatchObject({
      entityType: 'chat',
      payload: { title: 'keep this chat' },
    });
    expect(await facts.recall('shared-chat')).toBeUndefined();

    const otherMessage = newLocalRecord({
      id: 'msg-other',
      entityType: 'message',
      payload: { body: 'different id' },
      deviceId: DEVICE,
      occurredAt,
    });
    await applyLocalSync(store, otherMessage);
    expect(await facts.recall('shared-fact')).toEqual(saved);
    expect(await store.read((tx) => tx.get('message', 'msg-other'))).toMatchObject({ entityType: 'message' });

    expect(() => assertSyncDoesNotCrossFactAndChat(
      { id: 'same', entityType: 'memory-fact' },
      { id: 'same', entityType: 'message' },
    )).toThrow(FactChatIsolationError);
    expect(() => assertSyncDoesNotCrossFactAndChat(
      { id: 'same', entityType: 'chat' },
      { id: 'same', entityType: 'memory-fact' },
    )).toThrow(FactChatIsolationError);
    expect(() => assertSyncDoesNotCrossFactAndChat(
      { id: 'fact-1', entityType: 'memory-fact' },
      { id: 'msg-1', entityType: 'message' },
    )).not.toThrow();
    expect(() => assertSyncDoesNotCrossFactAndChat(
      { id: 'same', entityType: 'memory-fact' },
      { id: 'same', entityType: 'memory-fact' },
    )).not.toThrow();
  });
});

describe('G20 chat sync does not mint facts', () => {
  const occurredAt = '2026-10-19T12:00:00.000Z';

  it('labels client-reported evidence as client-reported and does not upgrade an unlabeled fact', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    const claimedStatement = 'claimed by a client';
    const claimed = newLocalRecord({
      id: 'fact-claimed',
      entityType: 'memory-fact',
      payload: {
        key: 'k',
        statement: claimedStatement,
        clientId: 'client-claimed',
        sourceRunId: 'run-claimed',
        occurredAt,
        contentHash: factContentHash({ key: 'k', statement: claimedStatement }),
      },
      deviceId: DEVICE,
      occurredAt,
    });
    claimed.provenance = {
      deviceId: DEVICE,
      source: 'imported',
      evidence: CLIENT_REPORTED_EVIDENCE,
    };
    await facts.applySync(claimed);
    const recalled = await facts.recall('fact-claimed');
    expect(recalled?.provenance.evidence).toBe(CLIENT_REPORTED_EVIDENCE);
    expect(recalled?.provenance.evidence).toBe('client-reported');
    expect(isClientReported(recalled!)).toBe(true);
    expect(recalled?.provenance.sourceRunId).toBe('run-claimed');
    expect(recalled?.provenance.clientId).toBe('client-claimed');
    expect(recalled?.provenance.occurredAt).toBe(occurredAt);
    expect(recalled?.provenance.contentHash).toBe(factContentHash({ key: 'k', statement: claimedStatement }));

    const unlabeled = newLocalRecord({
      id: 'fact-unlabeled',
      entityType: 'memory-fact',
      payload: {
        key: 'k',
        statement: 'no label',
        clientId: 'client-unlabeled',
        sourceMessageId: 'msg-unlabeled',
        occurredAt,
        contentHash: factContentHash({ key: 'k', statement: 'no label' }),
      },
      deviceId: DEVICE,
      occurredAt,
    });
    await facts.applySync(unlabeled);
    const plain = await facts.recall('fact-unlabeled');
    expect(plain?.provenance.evidence).toBeUndefined();
    expect(isClientReported(plain!)).toBe(false);
    expect(plain?.provenance.evidence).not.toBe('client-reported');
  });

  it('does not create or duplicate a memory fact when a chat sync batch is applied', async () => {
    const store = createMemoryLocalFirstStore();
    const facts = createFactStore(store);
    const saved = await facts.remember({
      id: 'fact-existing',
      key: 'offline-default',
      statement: 'already known',
      deviceId: DEVICE,
      sourceRunId: 'run-existing',
      sourceMessageId: 'msg-1',
      clientId: 'client-existing',
      occurredAt,
    });
    const before = await facts.list();
    expect(before).toEqual([saved]);

    const batch: ChatSyncBatch = {
      chatId: 'chat-9',
      messages: [
        { id: 'msg-1', chatId: 'chat-9', entityType: 'message' },
        { id: 'msg-2', chatId: 'chat-9', entityType: 'message' },
        { id: saved.id, chatId: 'chat-9', entityType: 'message' },
      ],
    };
    const beforeCount = batch.messages.length;
    const refusal = refuseFactOnChatSync(saved, batch);
    const secondRefusal = refuseFactOnChatSync(saved, batch);
    expect(batch.messages).toHaveLength(beforeCount);
    expect(batch.messages.some((message) => message.id === saved.id && message.entityType !== 'message')).toBe(false);
    expect(refusal.code).toBe('FACT_CHAT_SYNC_REFUSED');
    expect(secondRefusal.code).toBe('FACT_CHAT_SYNC_REFUSED');
    expect(refusal.disconnected).not.toHaveProperty('chatId');
    expect(secondRefusal.disconnected.id).toBe(saved.id);
    expect(() => assertFactNotWrittenAsChatMessage('message')).toThrow('fact_written_as_chat_message');
    expect(() => assertFactNotWrittenAsChatMessage('chat')).toThrow(
      expect.objectContaining({ code: 'FACT_WRITTEN_AS_CHAT_MESSAGE' }),
    );

    const applyMessages = async () => {
      for (const message of batch.messages) {
        const incoming = newLocalRecord({
          id: message.id,
          entityType: message.entityType,
          payload: {
            chatId: message.chatId,
            body: saved.statement,
            key: saved.key,
          },
          deviceId: DEVICE,
          occurredAt,
        });
        if (message.id === saved.id) {
          await expect(applyLocalSync(store, incoming)).rejects.toBeInstanceOf(FactChatIsolationError);
          expect(() => assertFactNotWrittenAsChatMessage(message.entityType)).toThrow('fact_written_as_chat_message');
        } else {
          await applyLocalSync(store, incoming);
        }
      }
    };

    await applyMessages();
    await applyMessages();

    expect(await facts.list()).toEqual([saved]);
    expect(await facts.recall('msg-1')).toBeUndefined();
    expect(await facts.recall('msg-2')).toBeUndefined();
    expect(await facts.recall(saved.id)).toEqual(saved);
    const snapshot = await store.export();
    expect(snapshot.records.filter((record) => record.entityType === 'memory-fact')).toHaveLength(1);
    expect(snapshot.records.filter((record) => record.entityType === 'message')).toHaveLength(2);
    expect(snapshot.records.some((record) => record.entityType === 'memory-fact' && record.id === 'msg-1')).toBe(false);
  });
});
