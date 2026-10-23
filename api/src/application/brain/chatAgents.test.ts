/**
 * removeChatAgent — a caller who can open chat 7 may remove chat 7's agent invites and
 * nothing else. The assignment id is client-supplied, so the removal names its target
 * (`scope = 'chat'`, `scopeId = '7'`) and the use case refuses a row from another chat,
 * a project staffing or a lane.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessibleChat = vi.fn();
vi.mock('./chatTicketAccess', () => ({ accessibleChat: (...a: unknown[]) => accessibleChat(...a) }));
const bumpChatStructure = vi.fn(async () => undefined);
vi.mock('./chatCacheVersions', () => ({ bumpChatStructure: (...a: unknown[]) => bumpChatStructure(...(a as [])) }));
vi.mock('./agentDisplayNames', () => ({ resolveAgentIdentities: async () => new Map() }));

const { removeChatAgent, CHAT_SCOPE } = await import('./chatAgents');

const unassign = vi.fn();
const deps = { db: {}, env: {}, assignments: { unassign } } as never;

describe('removeChatAgent', () => {
  beforeEach(() => {
    accessibleChat.mockReset().mockResolvedValue({ id: 7 });
    unassign.mockReset();
    bumpChatStructure.mockClear();
  });

  it('scopes the removal to THIS chat', async () => {
    unassign.mockResolvedValue(true);
    expect(await removeChatAgent(deps, 3, 7, 'u-1', 'a-1')).toEqual({ removed: true });
    expect(unassign).toHaveBeenCalledWith(3, 'a-1', { scope: CHAT_SCOPE, scopeId: '7' });
    expect(bumpChatStructure).toHaveBeenCalled();
  });

  it('reports nothing removed (and bumps nothing) when the id belongs elsewhere', async () => {
    unassign.mockResolvedValue(false);
    expect(await removeChatAgent(deps, 3, 7, 'u-1', 'other-chat-invite')).toEqual({ removed: false });
    expect(bumpChatStructure).not.toHaveBeenCalled();
  });

  it('refuses a chat the caller cannot open', async () => {
    accessibleChat.mockResolvedValue(null);
    expect(await removeChatAgent(deps, 3, 7, 'u-1', 'a-1')).toEqual({ error: 'Chat not found' });
    expect(unassign).not.toHaveBeenCalled();
  });
});
