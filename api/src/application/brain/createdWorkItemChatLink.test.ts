/**
 * createdWorkItemChatLink — the create call links its item to the host-stamped chat.
 * Fakes only the chat-ticket use case (`ChatTicketService.linkTicket`); the mapping,
 * the host stamp and the caller identity are exercised for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  linkTicket: vi.fn(async (..._a: unknown[]) => ({ linkId: 1 }) as unknown),
  report: vi.fn(),
}));
vi.mock('./ChatTicketService', () => ({ ChatTicketService: function () { return { linkTicket: h.linkTicket }; } }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: h.report }));

import {
  CHAT_LINKED_CREATE_TOOL_IDS, chatLinkAccessUser, createdWorkItemLink, isChatLinkedCreateTool,
  linkCreatedWorkItemToChat, stampedChatId, withHostChat,
} from './createdWorkItemChatLink';

const db = {} as never;
const call = (tool: string, args: Record<string, unknown>, who: { userId?: string | null; agentRef?: string | null } = { userId: 'u1' }) =>
  ({ tenantId: 7, tool, arguments: args, env: {} as never, ...who });

beforeEach(() => vi.clearAllMocks());

// Ported from brain-embedded's `workItemLinkFromCreate` tests — the SAME expectations,
// now keyed by catalog id because the server owns the mapping.
describe('createdWorkItemLink', () => {
  it('maps a created task/epic/gap to its taskType kind + numeric ref, linkType created', () => {
    expect(createdWorkItemLink('tasks.create', { id: 158, taskType: 'epic' })).toEqual({ kind: 'epic', ref: '158', linkType: 'created' });
    expect(createdWorkItemLink('tasks.create', { id: 12, taskType: 'gap' })).toEqual({ kind: 'gap', ref: '12', linkType: 'created' });
    // A task with no/unknown taskType (a bug included) defaults to the 'task' tier.
    expect(createdWorkItemLink('tasks.create', { id: 7 })).toEqual({ kind: 'task', ref: '7', linkType: 'created' });
    expect(createdWorkItemLink('tasks.create', { id: 8, taskType: 'bug' })).toEqual({ kind: 'task', ref: '8', linkType: 'created' });
  });

  it('links a ceremony the agent creates back to the conversation', () => {
    expect(createdWorkItemLink('retro.create', { id: 'retro-uuid' })).toEqual({ kind: 'retro', ref: 'retro-uuid', linkType: 'created' });
    expect(createdWorkItemLink('poker.create_session', { id: 'poker-uuid' })).toEqual({ kind: 'poker', ref: 'poker-uuid', linkType: 'created' });
  });

  it('maps the strategy + spec create tools to their tier with the uuid ref', () => {
    expect(createdWorkItemLink('objectives.create', { id: 'obj-uuid' })).toEqual({ kind: 'objective', ref: 'obj-uuid', linkType: 'created' });
    expect(createdWorkItemLink('specs.create', { id: 'spec-uuid' })).toEqual({ kind: 'spec', ref: 'spec-uuid', linkType: 'created' });
    expect(createdWorkItemLink('portfolios.create', { id: 'pf-uuid' })).toEqual({ kind: 'portfolio', ref: 'pf-uuid', linkType: 'created' });
    expect(createdWorkItemLink('initiatives.create', { id: 'init-uuid' })).toEqual({ kind: 'initiative', ref: 'init-uuid', linkType: 'created' });
  });

  it('records an idempotent-hit (deduped) result as a linked, not created, edge', () => {
    expect(createdWorkItemLink('tasks.create', { id: 5, taskType: 'epic', deduped: true })).toEqual({ kind: 'epic', ref: '5', linkType: 'linked' });
  });

  it('returns null for non-create tools and results without a usable id', () => {
    expect(createdWorkItemLink('tasks.update', { id: 1 })).toBeNull();
    expect(createdWorkItemLink('specs.list', { specs: [] })).toBeNull();
    expect(createdWorkItemLink('objectives.create', {})).toBeNull();
    expect(createdWorkItemLink('objectives.create', { id: '  ' })).toBeNull();
    expect(createdWorkItemLink('tasks.create', null)).toBeNull();
  });

  it('leaves tickets.from_delta to link itself', () => {
    expect(isChatLinkedCreateTool('tickets.from_delta')).toBe(false);
    expect(createdWorkItemLink('tickets.from_delta', { id: 3 })).toBeNull();
    expect(CHAT_LINKED_CREATE_TOOL_IDS).toEqual([
      'tasks.create', 'objectives.create', 'specs.create', 'portfolios.create', 'initiatives.create', 'retro.create', 'poker.create_session',
    ]);
  });
});

describe('host chat stamp', () => {
  it('overrides a model-sent chatId on a create, strips it with no host chat, and leaves other tools alone', () => {
    expect(withHostChat('tasks.create', { title: 'T', chatId: 999 }, 42)).toEqual({ title: 'T', chatId: 42 });
    expect(withHostChat('tasks.create', { title: 'T', chatId: 999 }, null)).toEqual({ title: 'T' });
    expect(withHostChat('tasks.create', { title: 'T' }, undefined)).toEqual({ title: 'T' });
    expect(withHostChat('tickets.from_delta', { summary: 's', chatId: 999 }, null)).toEqual({ summary: 's', chatId: 999 });
  });

  it('reads only a positive integer chat id', () => {
    expect(stampedChatId({ chatId: 42 })).toBe(42);
    expect(stampedChatId({ chatId: '42' })).toBe(42);
    expect(stampedChatId({ chatId: 0 })).toBeNull();
    expect(stampedChatId({ chatId: 'abc' })).toBeNull();
    expect(stampedChatId({})).toBeNull();
    expect(stampedChatId(null)).toBeNull();
  });
});

describe('chatLinkAccessUser', () => {
  it('checks a human caller as themselves, and a cloud agent acting as itself tenant-scoped', () => {
    expect(chatLinkAccessUser({ userId: 'u1' })).toBe('u1');
    // An addressed-agent reply runs FOR a person: that person's access is checked.
    expect(chatLinkAccessUser({ userId: 'u1', agentRef: 'agent-7' })).toBe('u1');
    // A cloud run's userId is its own ref — no user identity to check membership for.
    expect(chatLinkAccessUser({ userId: 'agent-7', agentRef: 'agent-7' })).toBeNull();
    expect(chatLinkAccessUser({ userId: null, agentRef: 'agent-7' })).toBeNull();
    // A gateway caller with no identity is tenant-wide already.
    expect(chatLinkAccessUser({})).toBeNull();
  });
});

describe('linkCreatedWorkItemToChat', () => {
  it.each([
    ['tasks.create', { id: 15, taskType: 'gap' }, 'gap', '15'],
    ['objectives.create', { id: 'o-1' }, 'objective', 'o-1'],
    ['specs.create', { id: 's-1' }, 'spec', 's-1'],
    ['portfolios.create', { id: 'p-1' }, 'portfolio', 'p-1'],
    ['initiatives.create', { id: 'i-1' }, 'initiative', 'i-1'],
    ['retro.create', { id: 'r-1' }, 'retro', 'r-1'],
    ['poker.create_session', { id: 'k-1' }, 'poker', 'k-1'],
  ])('%s links its item to the stamped chat through linkTicket', async (tool, row, kind, ref) => {
    const out = await linkCreatedWorkItemToChat(db, call(tool, { chatId: 42 }), row);
    expect(h.linkTicket).toHaveBeenCalledWith(7, 42, 'u1', { kind, ref, linkType: 'created', createdBy: 'u1' });
    expect(out).toEqual({ ...row, chatLink: { linked: true, chatId: 42, linkType: 'created' } });
  });

  it('links an idempotent dedupe hit as linked', async () => {
    const out = await linkCreatedWorkItemToChat(db, call('tasks.create', { chatId: 42 }), { id: 5, deduped: true });
    expect(h.linkTicket).toHaveBeenCalledWith(7, 42, 'u1', expect.objectContaining({ kind: 'task', ref: '5', linkType: 'linked' }));
    expect(out).toMatchObject({ id: 5, deduped: true, chatLink: { linked: true, linkType: 'linked' } });
  });

  it('does nothing without a stamped chat, for an unmapped tool, or for tickets.from_delta', async () => {
    const row = { id: 9 };
    expect(await linkCreatedWorkItemToChat(db, call('tasks.create', {}), row)).toBe(row);
    expect(await linkCreatedWorkItemToChat(db, call('tasks.update', { chatId: 42 }), row)).toBe(row);
    expect(await linkCreatedWorkItemToChat(db, call('tickets.from_delta', { chatId: 42 }), row)).toBe(row);
    expect(h.linkTicket).not.toHaveBeenCalled();
  });

  it('keeps the create when the chat is inaccessible, and says why it did not link', async () => {
    h.linkTicket.mockResolvedValueOnce({ error: 'Chat not found' });
    const out = await linkCreatedWorkItemToChat(db, call('tasks.create', { chatId: 42 }), { id: 5, title: 'T' });
    expect(out).toEqual({ id: 5, title: 'T', chatLink: { linked: false, chatId: 42, reason: 'Chat not found' } });
  });

  it('keeps the create when the link throws, and reports the failure', async () => {
    h.linkTicket.mockRejectedValueOnce(new Error('db down'));
    const out = await linkCreatedWorkItemToChat(db, call('specs.create', { chatId: 42 }), { id: 's-1' });
    expect(out).toEqual({ id: 's-1', chatLink: { linked: false, chatId: 42, reason: 'db down' } });
    expect(h.report).toHaveBeenCalledTimes(1);
  });

  it('links a cloud agent acting as itself tenant-scoped, credited to the agent', async () => {
    await linkCreatedWorkItemToChat(db, call('tasks.create', { chatId: 42 }, { userId: 'agent-7', agentRef: 'agent-7' }), { id: 3 });
    expect(h.linkTicket).toHaveBeenCalledWith(7, 42, null, expect.objectContaining({ createdBy: 'agent-7' }));
  });
});
