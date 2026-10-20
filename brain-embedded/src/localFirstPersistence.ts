import {
  newLocalRecord,
  UNBOUND_DESTINATION,
  type EntityDestination,
  type JournalOperation,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import type { BrainPersistenceAdapter } from './config';
import type { BrainChat, BrainMessage } from './types';

interface ChatValue {
  clientId: string;
  chat: BrainChat;
}

interface MessageValue {
  clientId: string;
  chatId: number;
  chatClientId: string;
  eventKey: string;
  message: BrainMessage;
}

export interface LocalBrainPersistenceOptions {
  store: LocalFirstStore;
  deviceId: string;
  destination?: EntityDestination;
  summarizeUnavailable: string;
  createObjectURL?: (file: File) => string;
  now?: () => Date;
  newId?: () => string;
}

const chatValue = (record: LocalRecord<ChatValue>): BrainChat => record.payload.chat;

export function createLocalBrainPersistence(options: LocalBrainPersistenceOptions): BrainPersistenceAdapter {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const blobs = new Map<string, string>();

  const records = <T>(tx: LocalFirstTransaction, type: 'chat' | 'message') =>
    tx.list<T>(type).then((rows) => rows.filter((row) => !row.deletedAt));
  const chats = (tx: LocalFirstTransaction) => records<ChatValue>(tx, 'chat');
  const messages = (tx: LocalFirstTransaction) => records<MessageValue>(tx, 'message');
  const chatFor = async (tx: LocalFirstTransaction, id: number): Promise<LocalRecord<ChatValue>> => {
    const chat = (await chats(tx)).find((row) => row.payload.chat.id === id);
    if (!chat) throw new Error(`No such local chat: ${id}`);
    return chat;
  };
  const append = async <T>(
    tx: LocalFirstTransaction,
    record: LocalRecord<T>,
    operation: JournalOperation,
    eventId: string,
    dependsOn: string[] = [],
  ) => {
    await tx.append({
      eventId,
      clientEntityId: record.id,
      entityType: record.entityType,
      operation,
      schemaVersion: record.schemaVersion,
      occurredAt: record.occurredAt,
      ...(record.baseVersion !== undefined ? { baseVersion: record.baseVersion } : {}),
      dependsOn,
      destination: record.destination,
      payload: record.payload,
    });
  };
  const nextId = async (tx: LocalFirstTransaction): Promise<number> => {
    const [chatRows, messageRows] = await Promise.all([chats(tx), messages(tx)]);
    return Math.max(
      0,
      ...chatRows.map((row) => row.payload.chat.id),
      ...messageRows.map((row) => row.payload.message.id),
    ) + 1;
  };

  return {
    async listChats(params) {
      return options.store.read(async (tx) => {
        const all = (await chats(tx))
          .map(chatValue)
          .filter((chat) => !chat.isArchived)
          .filter((chat) => params?.projectId == null || String(chat.projectId) === params.projectId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
        const offset = params?.offset ?? 0;
        return params?.limit != null ? all.slice(offset, offset + params.limit) : all.slice(offset);
      });
    },
    getChat: (id) => options.store.read((tx) => chatFor(tx, id).then(chatValue)),
    async createChat(body) {
      return options.store.transact(async (tx) => {
        const [id, clientId] = [await nextId(tx), newId()];
        const stamp = now().toISOString();
        const chat: BrainChat = {
          id,
          title: body.title ?? 'New chat',
          projectId: body.projectId ?? null,
          origin: 'local',
          capability: body.capability ?? null,
          mode: body.mode ?? null,
          originalRequest: body.originalRequest ?? null,
          createdAt: stamp,
          updatedAt: stamp,
        };
        const record = newLocalRecord<ChatValue>({
          id: clientId,
          entityType: 'chat',
          payload: { clientId, chat },
          deviceId: options.deviceId,
          destination,
          occurredAt: stamp,
        });
        await tx.put(record);
        await append(tx, record, 'create', `chat:${clientId}`);
        return chat;
      });
    },
    async updateChat(id, body) {
      return options.store.transact(async (tx) => {
        const current = await chatFor(tx, id);
        const chat = { ...current.payload.chat, ...body, updatedAt: now().toISOString() };
        const next: LocalRecord<ChatValue> = {
          ...current,
          version: current.version + 1,
          baseVersion: current.version,
          updatedAt: chat.updatedAt,
          payload: { ...current.payload, chat },
        };
        await tx.put(next, current.version);
        await append(tx, next, 'update', `chat:${current.id}:v${next.version}`);
        return chat;
      });
    },
    async deleteChat(id) {
      return options.store.transact(async (tx) => {
        const chat = await chatFor(tx, id);
        const stamp = now().toISOString();
        const deleted = { ...chat, version: chat.version + 1, baseVersion: chat.version, deletedAt: stamp, updatedAt: stamp };
        await tx.put(deleted, chat.version);
        await append(tx, deleted, 'delete', `chat:${chat.id}:delete:v${deleted.version}`);
        const rows = (await messages(tx)).filter((row) => row.payload.chatId === id);
        for (const row of rows) {
          const tombstone = { ...row, version: row.version + 1, baseVersion: row.version, deletedAt: stamp, updatedAt: stamp };
          await tx.put(tombstone, row.version);
          await append(tx, tombstone, 'delete', `message:${row.id}:delete:v${tombstone.version}`, [`chat:${chat.id}:delete:v${deleted.version}`]);
        }
        return {};
      });
    },
    /**
     * Archive, not destroy. Unlike `deleteChat` this does NOT tombstone the row
     * (which would lose the conversation's summary): it marks the chat archived
     * and keeps it, mirroring the server's `isArchived` flag. `listChats` hides
     * archived rows, so the chat leaves the list without being deleted.
     */
    async archiveChat(id) {
      return options.store.transact(async (tx) => {
        const current = await chatFor(tx, id);
        const stamp = now().toISOString();
        const chat = { ...current.payload.chat, isArchived: true, updatedAt: stamp };
        const next: LocalRecord<ChatValue> = {
          ...current,
          version: current.version + 1,
          baseVersion: current.version,
          updatedAt: stamp,
          payload: { ...current.payload, chat },
        };
        await tx.put(next, current.version);
        await append(tx, next, 'update', `chat:${current.id}:archive:v${next.version}`);
        return { archived: true };
      });
    },
    summarizeChat: async () => ({ error: options.summarizeUnavailable }),
    async getMessages(chatId, limit) {
      return options.store.read(async (tx) => {
        const all = (await messages(tx))
          .filter((row) => row.payload.chatId === chatId)
          .sort((a, b) => a.payload.message.seq - b.payload.message.seq)
          .map((row) => row.payload.message);
        return limit != null ? all.slice(-limit) : all;
      });
    },
    subscribeMessages: (_chatId, onChanged) => options.store.subscribe(onChanged),
    async sendMessages(chatId, input) {
      return options.store.transact(async (tx) => {
        const chat = await chatFor(tx, chatId);
        const existing = (await messages(tx)).filter((row) => row.payload.chatId === chatId);
        const firstId = await nextId(tx);
        const stamp = now().toISOString();
        const added = input.map((message, index): BrainMessage => ({
          id: firstId + index,
          role: message.role,
          content: message.content,
          metadata: message.metadata ?? null,
          seq: existing.length + index + 1,
          createdAt: stamp,
        }));
        for (const [index, message] of added.entries()) {
          const source = input[index] as typeof input[number] & { eventKey?: string };
          const eventKey = source.eventKey ?? `message:${newId()}`;
          const clientId = newId();
          const record = newLocalRecord<MessageValue>({
            id: clientId,
            entityType: 'message',
            payload: { clientId, chatId, chatClientId: chat.id, eventKey, message },
            deviceId: options.deviceId,
            destination: chat.destination,
            occurredAt: stamp,
          });
          await tx.put(record);
          await append(tx, record, 'create', eventKey, [`chat:${chat.id}`]);
        }
        if (added.length > 0) {
          const nextChat = { ...chat, version: chat.version + 1, updatedAt: stamp, payload: { ...chat.payload, chat: { ...chat.payload.chat, updatedAt: stamp } } };
          await tx.put(nextChat, chat.version);
        }
        return added;
      });
    },
    async setMessageFeedback(messageId, feedback, context) {
      return options.store.transact(async (tx) => {
        const row = (await messages(tx)).find((candidate) => candidate.payload.message.id === messageId);
        if (!row) return {};
        const metadata = JSON.parse(row.payload.message.metadata ?? '{}') as Record<string, unknown>;
        metadata.feedback = feedback;
        if (context?.toolName) metadata.feedbackTool = context.toolName;
        const next = {
          ...row,
          version: row.version + 1,
          baseVersion: row.version,
          updatedAt: now().toISOString(),
          payload: { ...row.payload, message: { ...row.payload.message, metadata: JSON.stringify(metadata) } },
        };
        await tx.put(next, row.version);
        await append(tx, next, 'update', `message:${row.id}:feedback:v${next.version}`);
        return {};
      });
    },
    async upload(file) {
      const key = newId();
      const url = options.createObjectURL?.(file);
      if (url) blobs.set(key, url);
      await options.store.transact(async (tx) => {
        const record = newLocalRecord({
          id: key,
          entityType: 'attachment-manifest',
          payload: { key, name: file.name, type: file.type, size: file.size },
          deviceId: options.deviceId,
          destination,
        });
        await tx.put(record);
        await append(tx, record, 'create', `attachment:${key}`);
      });
      return { key, name: file.name, type: file.type };
    },
    uploadUrl: (key) => blobs.get(key) ?? '',
  };
}
