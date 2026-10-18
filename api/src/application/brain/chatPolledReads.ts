/**
 * The cached forms of the chat reads a client POLLS — transcript, human roster, invited
 * agents, the team-chat resolver. Each is the unchanged use case behind
 * {@link cachedChatRead}: per (chat, user), keyed on the chat's message/structure tokens
 * (`chatCacheVersions.ts`), so a poll that finds nothing new costs no Neon statement and
 * a `{ error }` (not found / forbidden) is never cached.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ChatTicketService } from './ChatTicketService';
import { getMessages } from './brainMessages';
import { listMembers } from './brainChatMembers';
import { getOrCreateTeamChat } from './brainScopedChats';
import type { TeamChatScope } from './brainChatShapes';
import { cachedChatRead, cachedTeamChat, isNotError } from './chatCacheVersions';

export function readMessagesCached(
  env: Env | undefined, db: Db, chatId: number, tenantId: number, userId: string, limit: number, afterSeq?: number,
) {
  return cachedChatRead(
    env, 'messages',
    { tenantId, chatId, userId, messages: true, variant: `${limit}:${afterSeq ?? '-'}` },
    () => getMessages(db, chatId, tenantId, userId, limit, afterSeq),
    isNotError,
  );
}

export function listMembersCached(env: Env | undefined, db: Db, chatId: number, tenantId: number, userId: string) {
  return cachedChatRead(env, 'members', { tenantId, chatId, userId }, () => listMembers(db, chatId, tenantId, userId), isNotError);
}

export function listAgentsCached(env: Env, db: Db, tenantId: number, chatId: number, userId: string) {
  return cachedChatRead(
    env, 'agents', { tenantId, chatId, userId },
    () => new ChatTicketService(db, env).listAgents(tenantId, chatId, userId),
    isNotError,
  );
}

export function resolveTeamChatCached(
  env: Env | undefined, db: Db, tenantId: number, userId: string, scope: TeamChatScope,
) {
  return cachedTeamChat(
    env, tenantId, userId, { projectId: scope.projectId ?? null, teamId: scope.teamId ?? null },
    () => getOrCreateTeamChat(db, tenantId, userId, scope),
  );
}
