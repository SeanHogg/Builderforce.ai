/**
 * Local chat + message persistence over the durable store (G03). Split out of
 * `localFirstStore.ts` — the store, its lock, and its journal live in their own
 * modules; this is only the chat/message rows the origin callers write.
 */

import type { BrainChat, BrainMessage } from "@seanhogg/builderforce-brain-embedded";
import {
  newLocalRecord,
  type JournalOperation,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from "@builderforce/local-first";

interface ChatPayload {
  clientId: string;
  chat: BrainChat;
}

interface MessagePayload {
  clientId: string;
  chatId: number;
  chatClientId: string;
  eventKey: string;
  message: BrainMessage;
}

/**
 * Chat and message writes for origin callers (`auditExecution`, `brainRunHostPorts`).
 * Writes go through the durable store, so an acknowledged chat is a journal frame.
 * This is not the full Brain adapter: list/update/delete/archive/summarize/upload
 * stay on the server adapter. Those methods are not called on this object.
 */
export function createLocalChatPersistence(store: LocalFirstStore, deviceId: string) {
  const stamp = () => new Date().toISOString();
  const live = async <T>(tx: LocalFirstTransaction, type: "chat" | "message") =>
    (await tx.list<T>(type)).filter((row) => !row.deletedAt);
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
  const nextNumericId = (chats: LocalRecord<ChatPayload>[], messages: LocalRecord<MessagePayload>[]) =>
    Math.max(
      0,
      ...chats.map((row) => row.payload.chat.id),
      ...messages.map((row) => row.payload.message.id),
    ) + 1;
  return {
    async createChat(body: {
      title?: string;
      originalRequest?: string | null;
      projectId?: number | null;
      capability?: string | null;
      mode?: string | null;
    }): Promise<BrainChat> {
      return store.transact(async (tx) => {
        const chats = await live<ChatPayload>(tx, "chat");
        const messages = await live<MessagePayload>(tx, "message");
        const at = stamp();
        const clientId = crypto.randomUUID();
        const chat: BrainChat = {
          id: nextNumericId(chats, messages),
          title: body.title ?? "New chat",
          projectId: body.projectId ?? null,
          origin: "local",
          capability: body.capability ?? null,
          mode: body.mode ?? null,
          originalRequest: body.originalRequest ?? null,
          createdAt: at,
          updatedAt: at,
        };
        const record = newLocalRecord<ChatPayload>({
          id: clientId,
          entityType: "chat",
          payload: { clientId, chat },
          deviceId,
          occurredAt: at,
        });
        await tx.put(record);
        await append(tx, record, "create", `chat:${clientId}`);
        return chat;
      });
    },
    async getChat(id: number): Promise<BrainChat | undefined> {
      return store.read(async (tx) => {
        const row = (await live<ChatPayload>(tx, "chat")).find((candidate) => candidate.payload.chat.id === id);
        return row?.payload.chat;
      });
    },
    async getMessages(chatId: number): Promise<BrainMessage[]> {
      return store.read(async (tx) =>
        (await live<MessagePayload>(tx, "message"))
          .filter((row) => row.payload.chatId === chatId)
          .sort((a, b) => a.payload.message.seq - b.payload.message.seq)
          .map((row) => row.payload.message),
      );
    },
    async sendMessages(
      chatId: number,
      input: Array<{ role: string; content: string; metadata?: string }>,
    ): Promise<BrainMessage[]> {
      return store.transact(async (tx) => {
        const chats = await live<ChatPayload>(tx, "chat");
        const messages = await live<MessagePayload>(tx, "message");
        const chat = chats.find((row) => row.payload.chat.id === chatId);
        if (!chat) throw new Error(`No such local chat: ${chatId}`);
        const existing = messages.filter((row) => row.payload.chatId === chatId);
        const firstId = nextNumericId(chats, messages);
        const at = stamp();
        const added = input.map((message, index): BrainMessage => ({
          id: firstId + index,
          role: message.role,
          content: message.content,
          metadata: message.metadata ?? null,
          seq: existing.length + index + 1,
          createdAt: at,
        }));
        for (const message of added) {
          const clientId = crypto.randomUUID();
          const eventKey = `message:${clientId}`;
          const record = newLocalRecord<MessagePayload>({
            id: clientId,
            entityType: "message",
            payload: { clientId, chatId, chatClientId: chat.id, eventKey, message },
            deviceId,
            destination: chat.destination,
            occurredAt: at,
          });
          await tx.put(record);
          await append(tx, record, "create", eventKey, [`chat:${chat.id}`]);
        }
        return added;
      });
    },
  };
}

export type LocalChatPersistence = ReturnType<typeof createLocalChatPersistence>;
