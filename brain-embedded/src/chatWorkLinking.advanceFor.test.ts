import { describe, expect, it } from 'vitest';
import { canListChatTickets, declaresChatTicketListing, linkedTicketsToAdvanceFor } from './chatWorkLinking';

const page = (tickets: unknown[]) => ({ tickets, total: tickets.length, matched: tickets.length, hasMore: false });
const LISTING = [{ function: { name: 'builtin_chats_list_tickets' } }];

describe('linkedTicketsToAdvanceFor', () => {
  it('advances every not-started link when the chat links no open epic (the chat\'s own ticket is the work it was opened for)', () => {
    const listed = [
      { kind: 'task', ref: '42', status: 'backlog', exists: true },
      { kind: 'task', ref: '43', status: 'done', exists: true },
    ];
    expect(linkedTicketsToAdvanceFor(listed, new Set(['7']))).toEqual([{ kind: 'task', ref: '42' }]);
  });

  it('regression (chat #276): under an open epic, advances only the not-started children the run owns', () => {
    const listed = page([
      { kind: 'epic', ref: '6902', status: 'in_progress', exists: true },
      { kind: 'task', ref: '6905', status: 'backlog', exists: true },
      { kind: 'task', ref: '6906', status: 'todo', exists: true },
    ]);
    expect(linkedTicketsToAdvanceFor(listed, new Set())).toEqual([]);
    expect(linkedTicketsToAdvanceFor(listed, new Set(['6906']))).toEqual([{ kind: 'task', ref: '6906' }]);
  });
});

describe('the listing gates', () => {
  it('a declared catalog answers for itself; an undeclared one may still be asked (canListChatTickets) but never holds a run (declaresChatTicketListing)', () => {
    expect(canListChatTickets(LISTING)).toBe(true);
    expect(canListChatTickets([])).toBe(false);
    expect(canListChatTickets(undefined)).toBe(true);
    expect(declaresChatTicketListing(LISTING)).toBe(true);
    expect(declaresChatTicketListing(undefined)).toBe(false);
  });
});
