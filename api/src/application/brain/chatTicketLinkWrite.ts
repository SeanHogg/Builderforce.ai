/**
 * chatTicketLinkWrite — the ONE write of a chat↔ticket link row.
 *
 * Shared by `linkTicket` (an agent/human linking through the API) and the sync ticket
 * importer (a VS Code ticket that names the chat it was created in), so the lineage
 * rule lives in one place: a link is idempotent on (chat, kind, ref), and a link that
 * was 'created' is never downgraded to 'linked'.
 *
 * Takes any database handle (`Db` or a unit-of-work `Tx`) and does NOT bump the caches:
 * the caller decides when the write is durable (a transaction bumps after it commits).
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { ambientEnv } from '../../infrastructure/cache/versionToken';
import type { Db, Tx } from '../../infrastructure/database/connection';
import { chatTicketLinks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpExecutionState } from '../runtime/executionStateVersion';
import { bumpChatStructure } from './chatCacheVersions';
import type { LinkType } from './chatTicketTypes';

export type ChatTicketLinkRow = typeof chatTicketLinks.$inferSelect;

export interface ChatTicketLinkWrite {
  tenantId: number;
  chatId: number;
  kind: string;
  ref: string;
  linkType: LinkType;
  createdBy: string | null;
  /** Omitted ⇒ the database trigger derives it from the tenant (single-mode writers). */
  segmentId?: string;
}

/**
 * Orphan what a link change invalidates: the chat's structure (its ticket rail) and the
 * tenant's attention snapshot (TTL 300 s), which counts linked tickets. `env` omitted ⇒
 * the request's ambient env (a sync import has no handle of its own).
 */
export function bumpChatTicketLinkCaches(tenantId: number, chatId: number, env?: Env): Promise<unknown> {
  const target = env ?? ambientEnv();
  return Promise.all([bumpChatStructure(chatId, target), bumpExecutionState(target, tenantId)]);
}

/** Whether the (chat, kind, ref) link already exists: a pure read, so a replay can skip the write. */
export async function chatTicketLinkExists(db: Db | Tx, tenantId: number, chatId: number, kind: string, ref: string): Promise<boolean> {
  const rows = await db.select({ id: chatTicketLinks.id }).from(chatTicketLinks)
    .where(scopedToTenant(chatTicketLinks, tenantId, eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref))).limit(1);
  return rows.length > 0;
}

/** Insert the link, or update an existing one keeping a 'created' lineage. */
export async function upsertChatTicketLink(db: Db | Tx, input: ChatTicketLinkWrite): Promise<ChatTicketLinkRow> {
  const { tenantId, chatId, kind, ref, linkType } = input;
  const [existing] = await db.select({ id: chatTicketLinks.id, linkType: chatTicketLinks.linkType }).from(chatTicketLinks)
    .where(scopedToTenant(chatTicketLinks, tenantId, eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref))).limit(1);
  if (existing) {
    // A later delta may re-link a ticket originally CREATED by this chat. Keep
    // that stronger lineage instead of downgrading it to a generic link.
    const effectiveLinkType = existing.linkType === 'created' ? 'created' : linkType;
    const [row] = await db.update(chatTicketLinks).set({ linkType: effectiveLinkType })
      .where(scopedToTenant(chatTicketLinks, tenantId, eq(chatTicketLinks.id, existing.id))).returning();
    return row!;
  }
  const [row] = await db.insert(chatTicketLinks).values({
    tenantId,
    ...(input.segmentId ? { segmentId: input.segmentId } : {}),
    chatId,
    ticketKind: kind,
    ticketRef: ref,
    linkType,
    createdBy: input.createdBy,
  }).returning();
  return row!;
}

/**
 * Remove the (chat, kind, ref) link: the ONE delete of a link row, shared by `unlinkTicket`
 * (an API caller) and the sync importer (a device's unlink tombstone). Like the upsert it takes
 * any database handle and does not bump the caches. Returns whether a row was removed.
 */
export async function deleteChatTicketLink(db: Db | Tx, tenantId: number, chatId: number, kind: string, ref: string): Promise<boolean> {
  const rows = await db.delete(chatTicketLinks)
    .where(and(eq(chatTicketLinks.tenantId, tenantId), eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.ticketKind, kind), eq(chatTicketLinks.ticketRef, ref)))
    .returning();
  return rows.length > 0;
}
