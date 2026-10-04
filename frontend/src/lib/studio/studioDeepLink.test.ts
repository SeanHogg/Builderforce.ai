import { describe, expect, it } from 'vitest';
import { namesProjectChat, parseTicketParam, studioChatHref, studioChatLinkFrom } from './studioDeepLink';

const params = (query: string) => new URLSearchParams(query);

describe('studio chat links', () => {
  it('reads a chat id and a linked work item', () => {
    expect(studioChatLinkFrom(params('chat=42&ticket=task:7'))).toEqual({ chatId: 42, ticket: { kind: 'task', ref: '7' } });
  });

  it('ignores a malformed chat id and a ticket kind a chat cannot link to', () => {
    expect(studioChatLinkFrom(params('chat=abc&ticket=invoice:7'))).toEqual({ chatId: null, ticket: null });
    expect(parseTicketParam(':7')).toBeNull();
    expect(parseTicketParam('epic:')).toBeNull();
  });

  it('only a link naming a chat belongs in Studio', () => {
    expect(namesProjectChat(studioChatLinkFrom(params('prompt=hi')))).toBe(false);
    expect(namesProjectChat(studioChatLinkFrom(params('ticket=gap:3')))).toBe(true);
  });

  it('builds the Studio page for that chat', () => {
    expect(studioChatHref(900, { chatId: 42, ticket: null })).toBe('/studio/project/900?chat=42');
    expect(studioChatHref(900, { chatId: null, ticket: { kind: 'epic', ref: 'E1' } })).toBe('/studio/project/900?ticket=epic%3AE1');
    expect(studioChatHref(900, { chatId: null, ticket: null })).toBe('/studio/project/900');
  });
});
