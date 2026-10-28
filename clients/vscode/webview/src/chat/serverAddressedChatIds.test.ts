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

  it('a link binds the local chat before it names a server chat', () => {
    const link = rail.slice(rail.indexOf('const linkTicket = useCallback'));
    expect(link.indexOf('bindChat')).toBeGreaterThan(-1);
    expect(link.indexOf('bindChat')).toBeLessThan(link.indexOf('ticketAdapter.linkTicket('));
  });

  it('memory recall is scoped by the server id', () => {
    expect(memory).toContain('vsixWebviewMemoryHooks(projectId, req, serverChatId)');
  });
});
