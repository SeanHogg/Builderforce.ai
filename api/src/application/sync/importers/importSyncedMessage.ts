/**
 * PRD 36.4 — import one VS Code chat message as history, not as a turn.
 *
 * The message becomes a `brain_chat_messages` row on the server chat its local chat
 * was imported as (`importSyncedChat`). It is a TRANSCRIPT ROW and nothing more:
 * this does not go through `appendMessages`, so no Evermind learn runs, no agent is
 * asked to reply, no mention or notification is sent and no unread badge is raised —
 * an old conversation arriving from a laptop is not news to anybody.
 *
 * Parent first. The chat is resolved through the tenant's sync mapping of
 * `chatClientId`; an unmapped chat answers `pending` (receipt `dependency_pending`,
 * nothing written), so a message that raced ahead of its chat is retried rather than
 * lost. Clients list the chat import in `dependsOn`, which normally holds it earlier.
 *
 * Idempotent twice over: the sync mapping answers a replayed event, and the chat's
 * `event_key` index answers a row that is already there (an earlier direct append
 * under the same key) — that row is adopted, never duplicated.
 *
 * The projection payload is the client's `MessageValue` verbatim: clients pull it
 * back into their local store, so the round trip is identity.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Tx } from '../../../infrastructure/database/connection';
import { brainChatMessages, brainChats } from '../../../infrastructure/database/schema';
import { bumpChatMessages } from '../../brain/chatCacheVersions';
import { isStepId } from '../../brain/chatStepStore';
import { isStepRow } from '@builderforce/agent-loop';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStepStore, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  clampedClientTime,
  conflict,
  insertedId,
  mappedChat,
  mutateGate,
  pending,
  preludeRejection,
  rejected,
  sameCanonical,
  serverNumericId,
  type BoundedImportOutcome,
} from './index';

const ROLES = new Set(['user', 'assistant', 'system', 'tool']);
/** `brain_chat_messages.event_key` is varchar(160). */
const EVENT_KEY_MAX = 160;

interface MessageFields {
  chatClientId: string;
  eventKey: string | null;
  role: string;
  content: string;
  metadata: string | null;
  createdAt: unknown;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

function readMessage(payload: unknown): Parsed<MessageFields> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.chatClientId !== 'string' || raw.chatClientId.trim() === '') return { ok: false, detail: 'message_chat_required' };
  const message = raw.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { ok: false, detail: 'message_payload_invalid' };
  const m = message as Record<string, unknown>;
  if (typeof m.role !== 'string' || !ROLES.has(m.role)) return { ok: false, detail: 'message_role_invalid' };
  if (typeof m.content !== 'string') return { ok: false, detail: 'message_content_invalid' };
  if (m.metadata != null && typeof m.metadata !== 'string') return { ok: false, detail: 'message_metadata_invalid' };
  const eventKey = typeof raw.eventKey === 'string' && raw.eventKey.trim() !== '' ? raw.eventKey.slice(0, EVENT_KEY_MAX) : null;
  return {
    ok: true,
    value: {
      chatClientId: raw.chatClientId,
      eventKey,
      role: m.role,
      content: m.content,
      metadata: typeof m.metadata === 'string' ? m.metadata : null,
      createdAt: m.createdAt,
    },
  };
}

async function writeFailure(error: unknown, operation: string): Promise<BoundedImportOutcome> {
  reportCaughtError(error, { source: 'application/sync/importers/importSyncedMessage.ts', operation });
  return rejected('message_write_failed');
}

/** The row already on the chat under this event key (an earlier direct append). */
async function existingByKey(tx: Tx, chatId: number, eventKey: string): Promise<number | null> {
  const [row] = await tx
    .select({ id: brainChatMessages.id })
    .from(brainChatMessages)
    .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.eventKey, eventKey)))
    .limit(1);
  return row?.id ?? null;
}

async function createMessage(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  steps: SyncStepStore,
): Promise<BoundedImportOutcome> {
  const parsed = readMessage(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const fields = parsed.value;
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, event.payload)) return appliedExisting(mapping, event.payload);
    return conflict(mapping, 'entity_already_imported');
  }
  const chat = await mappedChat(stores, ctx, fields.chatClientId);
  if (chat.kind === 'unmapped') return pending('message_chat_pending');
  if (chat.kind === 'foreign') return rejected('message_chat_not_owned');
  const { chatId } = chat;
  // A run step is telemetry: it goes to the operational step store, not the transcript.
  if (isStepRow(fields)) {
    try {
      // The step commits on the operational store, outside this sync transaction; if
      // the transaction rolls back the client retries, so an unkeyed step is keyed by
      // its client entity id — the retry then answers the step the first attempt wrote.
      const id = await steps.append(ctx.auth.tenantId, chatId, {
        metadata: fields.metadata as string,
        eventKey: fields.eventKey ?? `sync:${event.clientEntityId}`.slice(0, EVENT_KEY_MAX),
        createdAt: clampedClientTime(fields.createdAt, ctx.now),
      });
      if (id === null) return rejected('message_insert_failed');
      await bumpChatMessages(chatId);
      return appliedNew(String(id), 1, ctx.destinationKey, event.payload);
    } catch (error) {
      return writeFailure(error, 'createStep');
    }
  }
  try {
    const rows = await tx.transaction((savepoint) => savepoint.insert(brainChatMessages).values({
      chatId,
      role: fields.role,
      content: fields.content,
      metadata: fields.metadata,
      eventKey: fields.eventKey,
      createdAt: clampedClientTime(fields.createdAt, ctx.now),
    }).onConflictDoNothing({
      // Restates the partial index's predicate (`check:conflict-targets`).
      target: [brainChatMessages.chatId, brainChatMessages.eventKey],
      where: isNotNull(brainChatMessages.eventKey),
    }).returning({ id: brainChatMessages.id }));
    const id = insertedId(rows) ?? (fields.eventKey ? await existingByKey(tx, chatId, fields.eventKey) : null);
    if (id === null) return rejected('message_insert_failed');
    await bumpChatMessages(chatId);
    return appliedNew(String(id), 1, ctx.destinationKey, event.payload);
  } catch (error) {
    return writeFailure(error, 'createMessage');
  }
}

/**
 * The chat a server message is on, when that chat is the caller's own. A delete names its
 * message by mapping alone — a tombstone carries no payload, so no chat id to resolve.
 */
async function ownMessageChatId(tx: Tx, ctx: SyncImportContext, messageId: number): Promise<number | null> {
  const [row] = await tx
    .select({ chatId: brainChatMessages.chatId })
    .from(brainChatMessages)
    .innerJoin(brainChats, eq(brainChats.id, brainChatMessages.chatId))
    .where(and(eq(brainChatMessages.id, messageId), eq(brainChats.tenantId, ctx.auth.tenantId), eq(brainChats.userId, ctx.auth.userId)))
    .limit(1);
  return row?.chatId ?? null;
}

/** Update (a feedback change rewrites `metadata`) and delete, both scoped to the chat. */
async function mutateMessage(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
  steps: SyncStepStore,
): Promise<BoundedImportOutcome> {
  const isDelete = event.operation === 'delete';
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  if (isStepId(id)) return mutateStep(event, ctx, stores, tx, current, id, steps);
  try {
    if (isDelete) {
      const chatId = await ownMessageChatId(tx, ctx, id);
      // Already gone, or not the caller's: nothing of theirs to delete.
      if (chatId === null) return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, null);
      await tx.transaction((savepoint) => savepoint.delete(brainChatMessages).where(and(eq(brainChatMessages.id, id), eq(brainChatMessages.chatId, chatId))));
      await bumpChatMessages(chatId);
      return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, null);
    }
    const parsed = readMessage(event.payload);
    if (!parsed.ok) return rejected(parsed.detail);
    const chat = await mappedChat(stores, ctx, parsed.value.chatClientId);
    if (chat.kind !== 'own') return rejected(chat.kind === 'foreign' ? 'message_chat_not_owned' : 'message_chat_unresolved');
    const { chatId } = chat;
    const scope = and(eq(brainChatMessages.id, id), eq(brainChatMessages.chatId, chatId));
    if (sameCanonical(current, event.payload)) return appliedExisting(current, event.payload);
    const rows = await tx.transaction((savepoint) => savepoint.update(brainChatMessages)
      .set({ metadata: parsed.value.metadata })
      .where(scope)
      .returning({ id: brainChatMessages.id }));
    if (insertedId(rows) === null) return rejected('message_not_found');
    await bumpChatMessages(chatId);
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, event.payload);
  } catch (error) {
    return writeFailure(error, isDelete ? 'deleteMessage' : 'updateMessage');
  }
}

/**
 * Update / delete of a message whose server id names a STEP (operational store). Same
 * ownership rule as a transcript row: the step's chat must be the caller's own.
 */
async function mutateStep(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  current: SyncEntityMappingRow,
  stepId: number,
  steps: SyncStepStore,
): Promise<BoundedImportOutcome> {
  try {
    if (event.operation === 'delete') {
      const chatId = await steps.chatOf(ctx.auth.tenantId, stepId);
      if (chatId !== null && await ownChat(tx, ctx, chatId)) {
        await steps.remove(chatId, stepId);
        await bumpChatMessages(chatId);
      }
      return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, null);
    }
    const parsed = readMessage(event.payload);
    if (!parsed.ok) return rejected(parsed.detail);
    const chat = await mappedChat(stores, ctx, parsed.value.chatClientId);
    if (chat.kind !== 'own') return rejected(chat.kind === 'foreign' ? 'message_chat_not_owned' : 'message_chat_unresolved');
    if (sameCanonical(current, event.payload)) return appliedExisting(current, event.payload);
    if (await steps.update(chat.chatId, stepId, parsed.value.metadata ?? '') === null) return rejected('message_not_found');
    await bumpChatMessages(chat.chatId);
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, event.payload);
  } catch (error) {
    return writeFailure(error, event.operation === 'delete' ? 'deleteStep' : 'updateStep');
  }
}

/** Whether a chat is the caller's own in their tenant. */
async function ownChat(tx: Tx, ctx: SyncImportContext, chatId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: brainChats.id })
    .from(brainChats)
    .where(and(eq(brainChats.id, chatId), eq(brainChats.tenantId, ctx.auth.tenantId), eq(brainChats.userId, ctx.auth.userId)))
    .limit(1);
  return !!row;
}

/** Apply one already-validated message mutation through the unit-of-work `tx`; a run
 *  step goes through the step store instead (`brain_chat_steps`, operational). */
export async function importSyncedMessage(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  steps: SyncStepStore,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'message') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'update' || event.operation === 'delete') return mutateMessage(event, ctx, stores, tx, mapping, steps);
  if (event.operation === 'create' || event.operation === 'import') return createMessage(event, ctx, stores, tx, mapping, steps);
  return rejected('operation_unsupported');
}
