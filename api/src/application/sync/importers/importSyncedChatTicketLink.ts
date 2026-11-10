/**
 * Import a device's chat-to-ticket link (G21), as history, not as a command.
 *
 * Writes through the ONE link write (`upsertChatTicketLink`) and the ONE link delete
 * (`deleteChatTicketLink`), inside a savepoint of the push's transaction. No agent hand-off
 * runs (that is `linkTicket`'s job, for a live link): a device recording an association is
 * not an instruction to anyone.
 *
 * Parents first. The link names two client ids, resolved the way the ticket importer resolves
 * its references: the chat through the tenant's `chat` mapping (and the caller's own chat), the
 * ticket through `resolveTaskId`. Until BOTH exist the answer is `pending` (receipt
 * `dependency_pending`), nothing written, so a link that raced ahead of its chat or ticket is
 * retried, never lost. A chat that is another member's is a permanent rejection.
 *
 * The sync mapping's server id is the `chat_ticket_links` row id; the stored payload is the
 * server form `{ chatId, ticketId, linkType }`, so a replay of the same event is `applied`
 * without a second write and a different payload under one client id is a conflict.
 * A tombstone removes the row and is acknowledged again, unchanged, on replay. A link is a
 * REVIVABLE relation (`REVIVABLE_ENTITY_TYPES`): create or update over its tombstone links again.
 * The payload may carry `chatServerId` / `ticketServerId` (server-origin entities); they resolve
 * before the client-id mappings.
 */

import { and, eq } from 'drizzle-orm';
import { TASK_TABLE_KINDS, isJournalEventId, parseSyncId } from '../../../domain/sync/syncProtocol';
import { bumpChatTicketLinkCaches, deleteChatTicketLink, upsertChatTicketLink } from '../../brain/chatTicketLinkWrite';
import { isTicketKind, ticketKindForTaskType } from '../../brain/chatTicketTypes';
import { resolveTicket } from '../../brain/ticketLookup';
import type { LinkType } from '../../brain/chatTicketTypes';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { resolveSegment } from '../../../infrastructure/auth/segmentResolver';
import type { Tx } from '../../../infrastructure/database/connection';
import { chatTicketLinks, tasks } from '../../../infrastructure/database/schema';
import { scopedToTenant } from '../../../infrastructure/database/tenantScope';
import type { SyncEntityMappingRow, SyncEventInput, SyncImportContext, SyncStoreSet } from '../syncPorts';
import {
  appliedExisting,
  appliedNew,
  conflict,
  mappedChat,
  mutateGate,
  pending,
  preludeRejection,
  rejected,
  sameCanonical,
  type BoundedImportOutcome,
} from './index';
import { mappedServerKey } from '../syncIds';

interface LinkPayload {
  chatClientId: string;
  ticketClientId: string;
  linkType: LinkType;
  /** The server's ids, when the device holds a mapping for a server-origin chat / ticket. */
  chatServerId?: string;
  ticketServerId?: string;
  /** A work item of a tier other than task/epic/gap: its address, resolved like the link route does. */
  ticketKind?: string;
  ticketRef?: string;
}

type Parsed = { ok: true; value: LinkPayload } | { ok: false; detail: string };

function readLink(payload: unknown): Parsed {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, detail: 'payload_invalid' };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.chatClientId !== 'string' || !isJournalEventId(raw.chatClientId)) return { ok: false, detail: 'link_chat_invalid' };
  if (typeof raw.ticketClientId !== 'string' || raw.ticketClientId.trim() === '') return { ok: false, detail: 'link_ticket_invalid' };
  if (raw.linkType !== 'linked' && raw.linkType !== 'created') return { ok: false, detail: 'link_type_invalid' };
  for (const key of ['chatServerId', 'ticketServerId'] as const) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || parseSyncId(raw[key]) === null)) {
      return { ok: false, detail: key === 'chatServerId' ? 'link_chat_invalid' : 'link_ticket_invalid' };
    }
  }
  if ((raw.ticketKind === undefined) !== (raw.ticketRef === undefined)) return { ok: false, detail: 'link_ticket_invalid' };
  if (raw.ticketKind !== undefined && (!isTicketKind(String(raw.ticketKind)) || typeof raw.ticketRef !== 'string' || raw.ticketRef.trim() === '')) {
    return { ok: false, detail: 'link_ticket_invalid' };
  }
  return {
    ok: true,
    value: {
      ...(typeof raw.ticketKind === 'string' && typeof raw.ticketRef === 'string' ? { ticketKind: raw.ticketKind, ticketRef: raw.ticketRef } : {}),
      chatClientId: raw.chatClientId,
      ticketClientId: raw.ticketClientId,
      linkType: raw.linkType,
      ...(typeof raw.chatServerId === 'string' ? { chatServerId: raw.chatServerId } : {}),
      ...(typeof raw.ticketServerId === 'string' ? { ticketServerId: raw.ticketServerId } : {}),
    },
  };
}

/** The server form a link is stored (and its replay hashed) as. */
function canonical(chatId: number, ref: string, linkType: LinkType): Record<string, unknown> {
  return { chatId: String(chatId), ticketId: ref, linkType };
}

/** `ref` is the work item's address in its tier: the task id for task/epic/gap, a uuid for the rest. */
type Resolved = { chatId: number; ref: string; kind: string };

async function resolveParents(
  payload: LinkPayload,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<Resolved | BoundedImportOutcome> {
  // The server id wins (a server-origin chat / ticket the device only ingested); the client-id
  // mapping is the fallback (a chat / ticket the device created).
  let chatId: number;
  const chatServerId = payload.chatServerId === undefined ? null : parseSyncId(payload.chatServerId);
  if (chatServerId !== null) {
    const own = await ctx.resolveOwnChatId(chatServerId);
    if (own === null) return rejected('link_chat_not_owned');
    chatId = own;
  } else {
    const chat = await mappedChat(stores, ctx, payload.chatClientId);
    if (chat.kind === 'foreign') return rejected('link_chat_not_owned');
    if (chat.kind === 'unmapped') return pending('link_chat_pending');
    chatId = chat.chatId;
  }
  // Every other tier (spec, objective, roadmap ...) is addressed by `(kind, ref)` on the payload and
  // resolved by the SAME resolver the `POST /chats/:id/tickets` route links through, so the importer
  // links exactly what that route links. An unknown or foreign ref is a permanent refusal.
  if (payload.ticketKind !== undefined && payload.ticketRef !== undefined && !TASK_TABLE_KINDS.has(payload.ticketKind)) {
    if (!(await resolveTicket(tx, ctx.auth.tenantId, payload.ticketKind, payload.ticketRef))) return rejected('link_ticket_not_owned');
    return { chatId, ref: payload.ticketRef, kind: payload.ticketKind };
  }
  let ticketId: number | null;
  if (payload.ticketServerId !== undefined) {
    // A server id the tenant does not own is a permanent refusal, like a foreign chat's.
    ticketId = await ctx.resolveTaskId(payload.ticketServerId);
    if (ticketId === null) return rejected('link_ticket_not_owned');
  } else {
    ticketId = await ctx.resolveTaskId(payload.ticketClientId);
    if (ticketId === null) return pending('link_ticket_pending');
  }
  const [task] = await tx.select({ taskType: tasks.taskType }).from(tasks)
    .where(and(eq(tasks.id, ticketId), eq(tasks.tenantId, ctx.auth.tenantId))).limit(1);
  if (!task) return pending('link_ticket_pending');
  return { chatId, ref: String(ticketId), kind: ticketKindForTaskType(task.taskType) };
}

/** The ONE link upsert, with the tenant's segment stamped as `linkTicket` does. */
async function upsertIn(savepoint: Tx, ctx: SyncImportContext, resolved: Resolved, linkType: LinkType) {
  return upsertChatTicketLink(savepoint, {
    tenantId: ctx.auth.tenantId,
    segmentId: await resolveSegment(savepoint, ctx.auth.tenantId),
    chatId: resolved.chatId,
    kind: resolved.kind,
    ref: resolved.ref,
    linkType,
    createdBy: ctx.auth.userId,
  });
}

/** The link row a (chat, ticket) pair names in this tenant, or undefined. */
async function linkRowOfPair(db: Tx, ctx: SyncImportContext, resolved: Resolved) {
  const [row] = await db.select({ id: chatTicketLinks.id }).from(chatTicketLinks)
    .where(scopedToTenant(chatTicketLinks, ctx.auth.tenantId, eq(chatTicketLinks.chatId, resolved.chatId), eq(chatTicketLinks.ticketKind, resolved.kind), eq(chatTicketLinks.ticketRef, resolved.ref))).limit(1);
  return row;
}

async function writeLink(
  ctx: SyncImportContext,
  tx: Tx,
  resolved: Resolved,
  linkType: LinkType,
  serverVersion: number,
): Promise<BoundedImportOutcome> {
  try {
    const row = await tx.transaction((savepoint) => upsertIn(savepoint, ctx, resolved, linkType));
    ctx.afterCommit(() => bumpChatTicketLinkCaches(ctx.auth.tenantId, resolved.chatId));
    // A 'created' lineage is never downgraded, so the stored form follows the row.
    // The row's own id: a link removed on the server while the mapping lived is inserted anew.
    return appliedNew(String(row.id), serverVersion, ctx.destinationKey, canonical(resolved.chatId, resolved.ref, row.linkType as LinkType));
  } catch (error) {
    reportCaughtError(error, { source: 'application/sync/importers/importSyncedChatTicketLink.ts', operation: 'writeLink' });
    return rejected('link_write_failed');
  }
}

/** Delete the link row a mapping names, inside the caller's savepoint; an already-gone row is the delete having won. */
async function deleteLinkRow(savepoint: Tx, ctx: SyncImportContext, linkId: number): Promise<void> {
  const [link] = await savepoint.select({ chatId: chatTicketLinks.chatId, kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef })
    .from(chatTicketLinks)
    .where(scopedToTenant(chatTicketLinks, ctx.auth.tenantId, eq(chatTicketLinks.id, linkId))).limit(1);
  if (!link) return;
  if ((await ctx.resolveOwnChatId(link.chatId)) === null) throw Object.assign(new Error('link_chat_not_owned'), { code: 'link_chat_not_owned' });
  await deleteChatTicketLink(savepoint, ctx.auth.tenantId, link.chatId, link.kind, link.ref);
  ctx.afterCommit(() => bumpChatTicketLinkCaches(ctx.auth.tenantId, link.chatId));
}

/**
 * A delete or update with NO mapping: the link was made on the server (the live `linkTicket` API)
 * and only ingested by the device, so the server never mapped it. The event carries the link
 * payload (chat / ticket client ids and server ids), which resolves the pair, ownership checked,
 * and the operation applies by (chat, ticket); the push then records the mapping.
 */
async function removeUnmapped(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  const parsed = readLink(event.payload);
  if (!parsed.ok) return rejected('entity_not_imported');
  const resolved = await resolveParents(parsed.value, ctx, stores, tx);
  if ('status' in resolved) return resolved;
  const tombstone = { removed: true };
  try {
    const row = await tx.transaction((savepoint) => removePair(savepoint, ctx, resolved));
    // No row ⇒ nothing to map: the protocol's applied outcome always carries a server id, and a
    // sentinel would be recorded as one, so an absent link is a distinct, non-mapping refusal.
    // `link_not_found` on a delete means ALREADY SATISFIED: the device settles it (local-first
    // `ALREADY_SATISFIED_DELETES`), it is not dead-lettered.
    if (!row) return rejected('link_not_found');
    return appliedNew(String(row.id), 1, ctx.destinationKey, tombstone);
  } catch (error) {
    reportCaughtError(error, { source: 'application/sync/importers/importSyncedChatTicketLink.ts', operation: 'removeUnmapped' });
    return rejected('link_delete_failed');
  }
}

async function removePair(savepoint: Tx, ctx: SyncImportContext, resolved: Resolved): Promise<{ id: number } | undefined> {
  const row = await linkRowOfPair(savepoint, ctx, resolved);
  if (!row) return undefined;
  await deleteChatTicketLink(savepoint, ctx.auth.tenantId, resolved.chatId, resolved.kind, resolved.ref);
  ctx.afterCommit(() => bumpChatTicketLinkCaches(ctx.auth.tenantId, resolved.chatId));
  return row;
}

async function removeLink(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  if (!mapping) return removeUnmapped(event, ctx, stores, tx);
  const tombstone = { removed: true };
  const gate = mutateGate(event, ctx, mapping, tombstone);
  if (gate) return gate;
  const linkId = mappedServerKey(mapping);
  if (linkId === null) return rejected('server_id_invalid');
  try {
    await tx.transaction((savepoint) => deleteLinkRow(savepoint, ctx, linkId));
  } catch (error) {
    if ((error as { code?: string }).code === 'link_chat_not_owned') return rejected('link_chat_not_owned');
    reportCaughtError(error, { source: 'application/sync/importers/importSyncedChatTicketLink.ts', operation: 'removeLink' });
    return rejected('link_delete_failed');
  }
  return appliedNew(mapping.serverId, mapping.serverVersion + 1, ctx.destinationKey, tombstone);
}

async function createLink(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  const parsed = readLink(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const resolved = await resolveParents(parsed.value, ctx, stores, tx);
  if ('status' in resolved) return resolved;
  if (!mapping) return writeLink(ctx, tx, resolved, parsed.value.linkType, 1);
  if (mapping.destinationKey !== ctx.destinationKey) return rejected('destination_mismatch');
  // A relation is revivable: re-creating a pair the server unlinked writes the link again (a new row id).
  if (mapping.deletedAt) return writeLink(ctx, tx, resolved, parsed.value.linkType, mapping.serverVersion + 1);
  const stored = canonical(resolved.chatId, resolved.ref, parsed.value.linkType);
  if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
  return conflict(mapping, 'entity_already_imported');
}

/** Whether the live link row `linkId` is on a DIFFERENT (chat, ticket) pair than `resolved`. */
async function pairDiffers(db: Tx, ctx: SyncImportContext, linkId: number, resolved: Resolved): Promise<boolean> {
  const [row] = await db.select({ chatId: chatTicketLinks.chatId, kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef }).from(chatTicketLinks)
    .where(scopedToTenant(chatTicketLinks, ctx.auth.tenantId, eq(chatTicketLinks.id, linkId))).limit(1);
  // The tier is part of the pair: a spec and an objective may not share a ref, but a link of one is never the other.
  return row !== undefined && (row.chatId !== resolved.chatId || row.kind !== resolved.kind || row.ref !== resolved.ref);
}

async function updateLink(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
  mapping: SyncEntityMappingRow | null,
): Promise<BoundedImportOutcome> {
  // No mapping: an ingested server-origin link being retyped. Same as a create (the upsert is
  // idempotent on the pair), which also records the mapping.
  if (!mapping) return createLink(event, ctx, stores, tx, mapping);
  const gate = mutateGate(event, ctx, mapping);
  if (gate) return gate;
  const parsed = readLink(event.payload);
  if (!parsed.ok) return rejected(parsed.detail);
  const resolved = await resolveParents(parsed.value, ctx, stores, tx);
  if ('status' in resolved) return resolved;
  // `mutateGate` let a tombstoned link through (revivable): the link row is new, so is its id.
  if (mapping.deletedAt) return writeLink(ctx, tx, resolved, parsed.value.linkType, mapping.serverVersion + 1);
  const linkId = mappedServerKey(mapping);
  // The pair is the link's identity: an update that names another pair would corrupt the mapping.
  if (linkId !== null && (await pairDiffers(tx, ctx, linkId, resolved))) return rejected('link_pair_immutable');
  const stored = canonical(resolved.chatId, resolved.ref, parsed.value.linkType);
  if (sameCanonical(mapping, stored)) return appliedExisting(mapping, stored);
  return writeLink(ctx, tx, resolved, parsed.value.linkType, mapping.serverVersion + 1);
}

/** Apply one already-validated link mutation through the unit-of-work `tx`. */
export async function importSyncedChatTicketLink(
  event: SyncEventInput,
  ctx: SyncImportContext,
  stores: SyncStoreSet,
  tx: Tx,
): Promise<BoundedImportOutcome> {
  if (event.entityType !== 'chat-ticket-link') return rejected('entity_type_rejected');
  const prelude = preludeRejection(event, ctx);
  if (prelude) return prelude;
  const mapping = await stores.findMapping(ctx.auth.tenantId, event.entityType, event.clientEntityId);
  if (event.operation === 'delete') return removeLink(event, ctx, stores, tx, mapping);
  if (event.operation === 'update') return updateLink(event, ctx, stores, tx, mapping);
  if (event.operation === 'create' || event.operation === 'import') return createLink(event, ctx, stores, tx, mapping);
  return rejected('operation_unsupported');
}
