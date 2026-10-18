/**
 * Agent-host chat sessions — persistence and history reads for `chat_sessions` /
 * `chat_messages`.
 *
 * The relay DO flushes a host's chat into {@link persistHostChatMessages}; the portal
 * reads it back through the list functions. Extracted from
 * `presentation/routes/chatRoutes.ts` so the routes stay thin adapters and every
 * statement here carries the tenant predicate.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { agentHosts, chatMessages, chatSessions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { verifyAgentHostApiKey, type AuthedAgentHost } from '../../infrastructure/auth/agentHostAuth';

export type { AuthedAgentHost };

/** Verify the host's own API key (an inactive host never authenticates). */
export function authenticateChatHost(db: Db, agentHostId: number, key: string | null | undefined, env: Env): Promise<AuthedAgentHost | null> {
  return verifyAgentHostApiKey(db, agentHostId, key, env);
}

export interface HostChatMessageInput {
  role: string;
  content: string;
  metadata?: string | null;
  seq: number;
}

/**
 * Upsert the session row for `sessionKey` and bulk-insert the messages.
 *
 * ONE multi-row insert (neon-http has no interactive tx); `onConflictDoNothing` keeps
 * the idempotent "skip duplicates" behaviour and the returned rows are exactly those
 * inserted, so `inserted` (and the session's running `msgCount`) is accurate.
 */
export async function persistHostChatMessages(
  db: Db,
  host: AuthedAgentHost,
  input: { sessionKey: string; projectId?: number | null; messages: HostChatMessageInput[] },
): Promise<{ inserted: number; sessionId: number }> {
  const tenantId = host.tenantId;
  const agentHostId = host.id;

  const [existing] = await db
    .select({ id: chatSessions.id, msgCount: chatSessions.msgCount })
    .from(chatSessions)
    .where(and(
      eq(chatSessions.agentHostId, agentHostId),
      eq(chatSessions.tenantId, tenantId),
      eq(chatSessions.sessionKey, input.sessionKey),
    ));

  let session: { id: number } | undefined = existing;
  if (!session) {
    const [created] = await db
      .insert(chatSessions)
      .values({ tenantId, agentHostId, sessionKey: input.sessionKey, projectId: input.projectId ?? null })
      .returning({ id: chatSessions.id });
    session = created;
  }
  if (!session) throw new Error('chat_sessions insert returned no row');
  const sessionId = session.id;

  let inserted = 0;
  if (input.messages.length > 0) {
    const insertedRows = await db
      .insert(chatMessages)
      .values(input.messages.map((msg) => ({
        tenantId,
        agentHostId,
        sessionId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata ?? null,
        seq: msg.seq,
      })))
      .onConflictDoNothing()
      .returning({ id: chatMessages.id });
    inserted = insertedRows.length;
  }

  await db
    .update(chatSessions)
    .set({ msgCount: (existing?.msgCount ?? 0) + inserted, lastMsgAt: new Date() })
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)));

  return { inserted, sessionId };
}

/** Every chat session in the tenant, across all hosts, most recently active first. */
export async function listTenantChatSessions(db: Db, tenantId: number, page: { limit: number; offset: number }) {
  return db
    .select({
      id:            chatSessions.id,
      agentHostId:   chatSessions.agentHostId,
      agentHostName: agentHosts.name,
      sessionKey:    chatSessions.sessionKey,
      projectId:     chatSessions.projectId,
      startedAt:     chatSessions.startedAt,
      endedAt:       chatSessions.endedAt,
      msgCount:      chatSessions.msgCount,
      lastMsgAt:     chatSessions.lastMsgAt,
    })
    .from(chatSessions)
    .innerJoin(agentHosts, eq(agentHosts.id, chatSessions.agentHostId))
    .where(eq(chatSessions.tenantId, tenantId))
    .orderBy(desc(chatSessions.lastMsgAt))
    .limit(page.limit)
    .offset(page.offset);
}

function sessionMessages(db: Db, tenantId: number, sessionId: number, limit: number) {
  return db
    .select({
      id:        chatMessages.id,
      role:      chatMessages.role,
      content:   chatMessages.content,
      metadata:  chatMessages.metadata,
      seq:       chatMessages.seq,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(scopedToTenant(chatMessages, tenantId, eq(chatMessages.sessionId, sessionId)))
    .orderBy(chatMessages.seq)
    .limit(limit);
}

export type HostChatMessage = Awaited<ReturnType<typeof sessionMessages>>[number];

/** A session's messages in seq order, or null when the session is not this tenant's. */
export async function listChatSessionMessages(db: Db, tenantId: number, sessionId: number, limit: number): Promise<HostChatMessage[] | null> {
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)));
  if (!session) return null;
  return sessionMessages(db, tenantId, session.id, limit);
}

/** A host session's messages looked up by its session key; empty when there is no such session. */
export async function listChatMessagesBySessionKey(
  db: Db,
  tenantId: number,
  agentHostId: number,
  sessionKey: string,
  limit: number,
): Promise<HostChatMessage[]> {
  const [session] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(
      eq(chatSessions.agentHostId, agentHostId),
      eq(chatSessions.tenantId, tenantId),
      eq(chatSessions.sessionKey, sessionKey),
    ));
  if (!session) return [];
  return sessionMessages(db, tenantId, session.id, limit);
}
