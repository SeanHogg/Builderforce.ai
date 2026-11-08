/**
 * A local chat's `id` is a view key that never leaves the machine (PRD 36): every
 * server-addressed call names the chat's BOUND server id, or is not made. The composer
 * broke it twice — the `#`-ticket typeahead read `/chats/6/tickets` for a chat bound to
 * 172 (a 404 on every rail refresh), and tagging a ticket linked it to whichever server
 * chat happened to be number 6 — and the webview's memory hooks carried the local id
 * into recall and answer pricing. Server reads live in the rail, keyed by `serverChatId`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');

describe('server-addressed chat ids in the VS Code chat', () => {
  const composer = src('VsCodeComposer.tsx');
  const rail = src('useTicketRail.ts');
  const memory = src('useChatMemory.ts');

  it('the composer makes no ticket call of its own', () => {
    expect(composer).not.toContain('listTickets(');
    expect(composer).not.toContain('ticketAdapter');
  });

  it('the rail reads the typeahead tickets by the server id', () => {
    expect(rail).toContain('listTickets(serverChatId)');
    expect(rail).not.toMatch(/listTickets\(chatId\)/);
  });

  // G21: a link is a LOCAL record, so it names the chat's bound server id or its local CLIENT id
  // (a string the host resolves to the record) — never the local view key, and never a bind first.
  it('a link names the server id or the local client id, never the view key, and binds nothing', () => {
    const link = rail.slice(rail.indexOf('const linkTicket = useCallback'));
    expect(link).toContain('serverChatIdOf(chat) ?? chat.clientId');
    expect(link).not.toContain('bindChat');
    expect(link).not.toMatch(/linkTicket\(localChatId/);
  });

  it('memory recall is scoped by the server id', () => {
    expect(memory).toContain('vsixWebviewMemoryHooks(projectId, req, serverChatId)');
  });
});
