import { describe, it, expect } from 'vitest';
import { mapTicketToSupportRow, isItsmProvider, type ItsmConnection } from './itsmIngest';
import type { NormalizedTicket } from './providers';

const conn: ItsmConnection = { id: 'c1', tenantId: 7, segmentId: 's1', provider: 'freshservice', pollCursor: null };
const now = new Date('2026-06-27T00:00:00.000Z');

function ticket(over: Partial<NormalizedTicket> & { fields?: Record<string, unknown> }): NormalizedTicket {
  return {
    externalId: '101', externalUrl: null, externalVersion: '2026-06-01', title: 'Login broken',
    body: null, state: 'open', source: 'freshservice', contentHash: 'h', fields: {}, ...over,
  };
}

describe('itsmIngest', () => {
  it('identifies ITSM providers', () => {
    expect(isItsmProvider('freshservice')).toBe(true);
    expect(isItsmProvider('servicenow')).toBe(true);
    expect(isItsmProvider('jira')).toBe(false);
  });

  it('maps a Freshservice incident → support_tickets row (bug + customer + priority)', () => {
    const row = mapTicketToSupportRow(conn, ticket({ fields: { priority: 'high', ticketType: 'Incident', requester: '555' } }), now);
    expect(row.tenantId).toBe(7);
    expect(row.source).toBe('freshservice');
    expect(row.externalRef).toBe('101');
    expect(row.subject).toBe('Login broken');
    expect(row.isBug).toBe(true);          // 'Incident' → bug
    expect(row.category).toBe('bug');
    expect(row.priority).toBe('high');
    expect(row.customerRef).toBe('555');
    expect(row.resolvedAt).toBeNull();      // still open
  });

  it('stamps resolvedAt for a terminal state and defaults non-bug requests', () => {
    const row = mapTicketToSupportRow(conn, ticket({ state: 'resolved', fields: { ticketType: 'Service Request' } }), now);
    expect(row.isBug).toBe(false);
    expect(row.category).toBe('other');
    expect(row.priority).toBe('normal');    // no priority field → default
    expect(row.resolvedAt).toEqual(now);
  });
});
