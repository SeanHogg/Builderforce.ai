/**
 * PRD 36.4 — import a VS Code chat as history, not as a command.
 *
 * A chat that lived only on one machine becomes a real `brain_chats` row in the
 * caller's tenant, owned by the caller, so it appears in the web chat list with
 * the server id its local copy is then bound to (the receipt's `serverId` writes
 * the client's chat mapping). Nothing else happens: no welcome message, no agent
 * invite, no title generation, no notification.
 *
 * ADOPTION. A chat the client already bound on sign-in (PRD 36.2, `POST
 * /api/brain/chats`) carries that id as a `serverId` hint. When it names a chat in
 * THIS tenant owned by THIS caller, the import adopts it instead of minting a
 * second row; any other id is ignored (never trusted, never an error).
 *
 * ROUND TRIP. The projection payload is the client's own `ChatValue` minus the
 * hint, because clients pull it straight back into their local store — the local
 * record must come back exactly as it went out. The payload-hash dedupe uses that
 * same stripped payload, so a retried import is `appliedExisting`.
 *
 * Writes go through `tx`, the push's unit of work, inside a savepoint (the same
 * discipline as `importSyncedTicket`).
 */

import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Tx } from '../../../infrastructure/database/connection';
import { brainChats } from '../../../infrastructure/database/schema';
import { BRAIN_ORIGIN } from '../../brain/chatAccess';
import { normalizeChatMode, NEW_CHAT_MODE } from '../../brain/chatMode';
import { normalizeChatTitle } from '../../brain/chatTitle';
import { normalizeCapability, normalizeOriginalRequest } from '../../brain/brainChatShapes';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  insertedId,
  mutateGate,
  preludeRejection,
  rejected,
  sameCanonical,
  serverNumericId,
  type BoundedImportOutcome,
} from './index';

/** The fields of the client's chat the server keeps. */
interface ChatFields {
  title: string;
  projectId: number | null;
  mode: string | null;
  capability: string | null;
  originalRequest: string | null;
  isArchived: boolean;
}

interface ParsedChat {
  fields: ChatFields;
  /** The client payload without the `serverId` hint — what is stored and hashed. */
  stored: Record<string, unknown>;
  serverIdHint: number | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string };

const optionalString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readChat(payload: unknown): Parsed<ParsedChat> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const { serverId, ...stored } = payload as Record<string, unknown>;
  const chat = stored.chat;
  if (!chat || typeof chat !== 'object' || Array.isArray(chat)) return { ok: false, detail: 'chat_payload_invalid' };
  const raw = chat as Record<string, unknown>;
  if (raw.title !== undefined && typeof raw.title !== 'string') return { ok: false, detail: 'chat_title_invalid' };
  const projectId = typeof raw.projectId === 'number' && Number.isSafeInteger(raw.projectId) && raw.projectId > 0
    ? raw.projectId
    : null;
  const hint = typeof serverId === 'number' && Number.isSafeInteger(serverId) && serverId > 0 ? serverId : null;
  return {
    ok: true,
    value: {
      fields: {
        title: normalizeChatTitle(optionalString(raw.title)),
        projectId,
        mode: normalizeChatMode(raw.mode),
        capability: normalizeCapability(optionalString(raw.capability)),
        originalRequest: normalizeOriginalRequest(optionalString(raw.originalRequest)),
        isArchived: raw.isArchived === true,
      },
      stored,
      serverIdHint: hint,
    },
  };
}

async function writeFailure(error: unknown, operation: string): Promise<BoundedImportOutcome> {
  reportCaughtError(error, { source: 'application/sync/importers/importSyncedChat.ts', operation });
  return rejected('chat_write_failed');
}

/** The hinted chat, when it is this caller's own chat in this tenant. */
async function adoptable(tx: Tx, ctx: SyncImportContext, chatId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: brainChats.id })
    .from(brainChats)
    .where(and(eq(brainChats.id, chatId), eq(brainChats.tenantId, ctx.auth.tenantId), eq(brainChats.userId, ctx.auth.userId)))
    .limit(1);
  return !!row;
}

/** A project the chat names, when this tenant owns it — else none (never a rejection). */
async function projectOf(ctx: SyncImportContext, projectId: number | null): Promise<number | null> {
  return projectId === null ? null : ctx.resolveProjectId(String(projectId));
}

async function createChat(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const parsed = readChat(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const { fields, stored, serverIdHint } = parsed.value;
  if (mapping) {
    if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
    if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
    return conflict(mapping, 'entity_already_imported');
  }
  if (serverIdHint !== null && (await adoptable(tx, ctx, serverIdHint))) {
    return appliedNew(String(serverIdHint), 1, ctx.destinationKey, stored);
  }
  const projectId = await projectOf(ctx, fields.projectId);
  try {
    const rows = await tx.transaction((savepoint) => savepoint.insert(brainChats).values({
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      // The web Brain's own origin, so the imported chat is listed and opened like any other.
      origin: BRAIN_ORIGIN,
      projectId,
      title: fields.title,
      originalRequest: fields.originalRequest,
      capability: fields.capability,
      mode: fields.mode ?? NEW_CHAT_MODE,
      isArchived: fields.isArchived,
      updatedAt: ctx.now,
    }).returning({ id: brainChats.id }));
    const id = insertedId(rows);
    if (id === null) return rejected('chat_insert_failed');
    return appliedNew(String(id), 1, ctx.destinationKey, stored);
  } catch (error) {
    return writeFailure(error, 'createChat');
  }
}

async function updateChat(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  const parsed = readChat(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const { fields, stored } = parsed.value;
  if (sameCanonical(current, stored)) return appliedExisting(current, stored);
  try {
    // `originalRequest` is write-once on the server; only a first capture lands.
    const rows = await tx.transaction((savepoint) => savepoint.update(brainChats).set({
      title: fields.title,
      isArchived: fields.isArchived,
      ...(fields.mode ? { mode: fields.mode } : {}),
      updatedAt: ctx.now,
    }).where(and(eq(brainChats.id, id), eq(brainChats.tenantId, ctx.auth.tenantId))).returning({ id: brainChats.id }));
    if (insertedId(rows) === null) return rejected('chat_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, stored);
  } catch (error) {
    return writeFailure(error, 'updateChat');
  }
}

async function deleteChat(
  event: SyncEventInput,
  ctx: SyncImportContext,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const tombstone = null;
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const current = mapping as SyncEntityMappingRow;
  const id = serverNumericId(current.serverId);
  if (id === null) return rejected('server_id_invalid');
  try {
    // A deleted local chat is ARCHIVED here, never destroyed: its usage and ticket
    // links keep pointing at a row that still exists.
    const rows = await tx.transaction((savepoint) => savepoint.update(brainChats).set({ isArchived: true, updatedAt: ctx.now })
      .where(and(eq(brainChats.id, id), eq(brainChats.tenantId, ctx.auth.tenantId))).returning({ id: brainChats.id }));
    if (insertedId(rows) === null) return rejected('chat_not_found');
    return appliedNew(current.serverId, current.serverVersion + 1, ctx.destinationKey, tombstone);
  } catch (error) {
    return writeFailure(error, 'deleteChat');
  }
}

/** Apply one already-validated chat mutation through the unit-of-work `tx`. */
export async function importSyncedChat(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'chat') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return deleteChat(event, ctx, tx, mapping);
  if (event.operation === 'update') return updateChat(event, ctx, tx, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createChat(event, ctx, tx, mapping);
  return rejected('operation_unsupported');
}
