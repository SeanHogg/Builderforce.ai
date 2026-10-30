import {
  newLocalRecord,
  UNBOUND_DESTINATION,
  type EntityDestination,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type LocalRecord,
} from '@builderforce/local-first';
import type { PriceBook } from '@builderforce/model-catalog';
import { summarizeTranscript, type SummaryCompletion } from '@seanhogg/builderforce-memory/working';
import { combineSpendSavings, type SpendSavingsSummary } from '@builderforce/spend-contract';
import type { BrainPersistenceAdapter } from './config';
import type { BrainChat, BrainMessage } from './types';
import { transcriptSeedOf } from './transcriptSeed';
import { boundServerId } from './localChat/chatIdentity';
import { journalWrite } from './localChat/journal';
import { liveRecords, type ChatValue, type MessageValue } from './localChat/records';
import { importedUsageIds, ledgerSpend, usageRowsByChat } from './localChat/ledgerSpend';
import type { RunUsageValue } from './localChat/usageLedger';

export interface LocalBrainPersistenceOptions {
  store: LocalFirstStore;
  deviceId: string;
  destination?: EntityDestination;
  /** Why "Consolidate" / "Fork" cannot run here — no {@link summarize} port. */
  summarizeUnavailable: string;
  /**
   * The model call a chat summary is written with (the ONE transcript summarizer,
   * `@seanhogg/builderforce-memory/working`). Omitted: summarizing reports
   * {@link summarizeUnavailable}.
   */
  summarize?: SummaryCompletion;
  /** Why a summary came back empty or failed (the model call errored). */
  summarizeFailed?: string;
  /**
   * The account destination chats bind into right now (PRD 36) — what `serverId` is
   * projected from. Omitted or undefined (signed out): every chat reads as unbound.
   */
  accountDestination?: () => EntityDestination | undefined;
  /**
   * The platform's spend for bound chats, by server id — the authoritative figure for
   * the calls the gateway served. Omitted, or failing: the device's own estimate stands.
   */
  serverSpend?: (serverIds: readonly number[]) => Promise<ReadonlyMap<number, SpendSavingsSummary>>;
  /** Bind a chat now (the host's chat identity). Omitted: the adapter offers no `bindChat`. */
  bindChat?: (chatId: number) => Promise<number | undefined>;
  /** The book a chat's own calls are priced with. Defaults to the bundled snapshot. */
  priceBook?: () => PriceBook;
  createObjectURL?: (file: File) => string;
  now?: () => Date;
  newId?: () => string;
}

const chatValue = (record: LocalRecord<ChatValue>): BrainChat => record.payload.chat;

/** A chat as its surfaces read it: its bound server id and its spend projected on. */
interface ProjectionInput {
  record: LocalRecord<ChatValue>;
  serverId: number | undefined;
  usage: readonly RunUsageValue[];
  /** The rows a sync import already put on the platform (bound chats only). */
  imported: ReadonlySet<string>;
}

export function createLocalBrainPersistence(options: LocalBrainPersistenceOptions): BrainPersistenceAdapter {
  const destination = options.destination ?? UNBOUND_DESTINATION;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const blobs = new Map<string, string>();

  const chats = (tx: LocalFirstTransaction) => liveRecords<ChatValue>(tx, 'chat', options.deviceId);
  const messages = (tx: LocalFirstTransaction) => liveRecords<MessageValue>(tx, 'message', options.deviceId);
  /** One chat's messages in `seq` order. */
  const chatMessages = (chatId: number): Promise<BrainMessage[]> => options.store.read(async (tx) =>
    (await messages(tx))
      .filter((row) => row.payload.chatId === chatId)
      .sort((a, b) => a.payload.message.seq - b.payload.message.seq)
      .map((row) => row.payload.message));
  const chatFor = async (tx: LocalFirstTransaction, id: number): Promise<LocalRecord<ChatValue>> => {
    const chat = (await chats(tx)).find((row) => row.payload.chat.id === id);
    if (!chat) throw new Error(`No such local chat: ${id}`);
    return chat;
  };
  const nextId = async (tx: LocalFirstTransaction): Promise<number> => {
    const [chatRows, messageRows] = await Promise.all([chats(tx), messages(tx)]);
    return Math.max(
      0,
      ...chatRows.map((row) => row.payload.chat.id),
      ...messageRows.map((row) => row.payload.message.id),
    ) + 1;
  };

  /** Read the chats' projection inputs in one pass: bindings and ledger rows. */
  const projectionInputs = async (tx: LocalFirstTransaction, rows: readonly LocalRecord<ChatValue>[]): Promise<ProjectionInput[]> => {
    const account = options.accountDestination?.();
    const usage = await usageRowsByChat(tx, options.deviceId);
    return Promise.all(rows.map(async (record) => {
      const serverId = await boundServerId(tx, record.id, account);
      const chatUsage = usage.get(record.id) ?? [];
      return {
        record,
        serverId,
        usage: chatUsage,
        imported: serverId !== undefined && account ? await importedUsageIds(tx, chatUsage, account) : new Set<string>(),
      };
    }));
  };

  /**
   * The spend each chat shows (§3.2): unbound — the device's fold over every call, the
   * gateway's priced from the bundled list (≈); bound — the platform's figure for the
   * gateway's calls plus the device's for the calls the platform never saw.
   */
  const project = async (inputs: readonly ProjectionInput[]): Promise<BrainChat[]> => {
    const bound = inputs.flatMap((input) => (input.serverId !== undefined ? [input.serverId] : []));
    let server: ReadonlyMap<number, SpendSavingsSummary> | null = null;
    if (bound.length > 0 && options.serverSpend) {
      try {
        server = await options.serverSpend(bound);
      } catch {
        server = null; // offline: the device's own estimate stands
      }
    }
    return inputs.map(({ record, serverId, usage, imported }) => {
      const chat = chatValue(record);
      // The platform's figure covers the gateway's calls only when it HAS this chat; a
      // chat it could not report keeps the device's estimate of every call.
      const fromServer = serverId !== undefined ? server?.get(serverId) ?? null : null;
      const local = ledgerSpend(usage, {
        excludeGateway: fromServer !== null,
        imported,
        ...(options.priceBook ? { book: options.priceBook() } : {}),
      });
      const spend = fromServer && local ? combineSpendSavings(fromServer, local) : fromServer ?? local;
      return {
        ...chat,
        ...(serverId !== undefined ? { serverId } : {}),
        ...(spend ? { spend } : {}),
      };
    });
  };

  return {
    async listChats(params) {
      const inputs = await options.store.read(async (tx) => {
        const all = (await chats(tx))
          .filter((row) => !row.payload.chat.isArchived)
          .filter((row) => params?.projectId == null || String(row.payload.chat.projectId) === params.projectId)
          .sort((a, b) => b.payload.chat.updatedAt.localeCompare(a.payload.chat.updatedAt) || b.payload.chat.id - a.payload.chat.id);
        const offset = params?.offset ?? 0;
        const page = params?.limit != null ? all.slice(offset, offset + params.limit) : all.slice(offset);
        return projectionInputs(tx, page);
      });
      return project(inputs);
    },
    async getChat(id) {
      const inputs = await options.store.read(async (tx) => projectionInputs(tx, [await chatFor(tx, id)]));
      return (await project(inputs))[0]!;
    },
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
        await journalWrite(tx, record, 'create', { key: `chat:${clientId}` });
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
        await journalWrite(tx, next, 'update', { key: `chat:${current.id}:v${next.version}` });
        return chat;
      });
    },
    async deleteChat(id) {
      return options.store.transact(async (tx) => {
        const chat = await chatFor(tx, id);
        const stamp = now().toISOString();
        const deleted = { ...chat, version: chat.version + 1, baseVersion: chat.version, deletedAt: stamp, updatedAt: stamp };
        const chatDeleteKey = `chat:${chat.id}:delete:v${deleted.version}`;
        await tx.put(deleted, chat.version);
        await journalWrite(tx, deleted, 'delete', { key: chatDeleteKey });
        const rows = (await messages(tx)).filter((row) => row.payload.chatId === id);
        for (const row of rows) {
          const tombstone = { ...row, version: row.version + 1, baseVersion: row.version, deletedAt: stamp, updatedAt: stamp };
          await tx.put(tombstone, row.version);
          await journalWrite(tx, tombstone, 'delete', {
            key: `message:${row.id}:delete:v${tombstone.version}`,
            dependsOn: [chatDeleteKey],
            chatClientId: chat.id,
          });
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
        await journalWrite(tx, next, 'update', { key: `chat:${current.id}:archive:v${next.version}` });
        return { archived: true };
      });
    },
    async summarizeChat(chatId) {
      if (!options.summarize) return { error: options.summarizeUnavailable };
      // What the model would be seeded with — from the last consolidation, no step rows.
      const seed = transcriptSeedOf(await chatMessages(chatId)).messages;
      // Under two turns there is nothing to consolidate: an empty summary says so.
      if (seed.length < 2) return { summary: '' };
      const summary = await summarizeTranscript(options.summarize, seed);
      return summary ? { summary } : { error: options.summarizeFailed ?? options.summarizeUnavailable };
    },
    ...(options.bindChat ? { bindChat: options.bindChat } : {}),
    async getMessages(chatId, limit) {
      const all = await chatMessages(chatId);
      return limit != null ? all.slice(-limit) : all;
    },
    subscribeMessages: (_chatId, onChanged) => options.store.subscribe(onChanged),
    async sendMessages(chatId, input) {
      return options.store.transact(async (tx) => {
        const chat = await chatFor(tx, chatId);
        const existing = (await messages(tx)).filter((row) => row.payload.chatId === chatId);
        const firstId = await nextId(tx);
        const stamp = now().toISOString();
        // A row sent again under the key it was saved with is the SAME row: the saved one comes back, nothing is
        // written (the server's upsert on (chat, event_key), kept on the device).
        const known = new Map(existing.map((row) => [row.payload.eventKey, row.payload.message] as const));
        const results: BrainMessage[] = [];
        const added: BrainMessage[] = [];
        const keys: string[] = [];
        for (const message of input) {
          const sentKey = (message as typeof message & { eventKey?: string }).eventKey;
          const prior = sentKey ? known.get(sentKey) : undefined;
          if (prior) {
            results.push(prior);
            continue;
          }
          const row: BrainMessage = {
            id: firstId + added.length,
            role: message.role,
            content: message.content,
            metadata: message.metadata ?? null,
            seq: existing.length + added.length + 1,
            createdAt: stamp,
          };
          results.push(row);
          added.push(row);
          keys.push(sentKey ?? `message:${newId()}`);
          if (sentKey) known.set(sentKey, row);
        }
        for (const [index, message] of added.entries()) {
          const eventKey = keys[index]!;
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
          await journalWrite(tx, record, 'create', { key: eventKey, dependsOn: [`chat:${chat.id}`], chatClientId: chat.id });
        }
        if (added.length > 0) {
          const nextChat = { ...chat, version: chat.version + 1, updatedAt: stamp, payload: { ...chat.payload, chat: { ...chat.payload.chat, updatedAt: stamp } } };
          await tx.put(nextChat, chat.version);
        }
        return results;
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
        await journalWrite(tx, next, 'update', { key: `message:${row.id}:feedback:v${next.version}`, chatClientId: row.payload.chatClientId });
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
        await journalWrite(tx, record, 'create', { key: `attachment:${key}` });
      });
      return { key, name: file.name, type: file.type };
    },
    uploadUrl: (key) => blobs.get(key) ?? '',
  };
}
