import { describe, expect, it } from 'vitest';
import {
  isChatTicketComplete,
  parseChatTicketSort,
  sortChatTickets,
  type SortableChatTicket,
} from './sortChatTickets';

const row = (label: string, progressPct: number): SortableChatTicket => ({ label, progressPct });

const MIXED: SortableChatTicket[] = [
  row('Implement Managed Agent', 100),
  row('Marketplace monetization', 50),
  row('SOC 2 Type I audit', 0),
  row('Onboarding — first Agent', 100),
  row('Enterprise license GA', 100),
];

describe('sortChatTickets', () => {
  it('open (default) puts incomplete tickets above 100% ones, then by progress then title', () => {
    expect(sortChatTickets(MIXED, 'open').map((t) => t.label)).toEqual([
      'SOC 2 Type I audit',
      'Marketplace monetization',
      'Enterprise license GA',
      'Implement Managed Agent',
      'Onboarding — first Agent',
    ]);
  });

  it('done puts complete tickets first, then by progress descending', () => {
    expect(sortChatTickets(MIXED, 'done').map((t) => t.label)).toEqual([
      'Enterprise license GA',
      'Implement Managed Agent',
      'Onboarding — first Agent',
      'Marketplace monetization',
      'SOC 2 Type I audit',
    ]);
  });

  it('title is alphabetical and ignores progress', () => {
    expect(sortChatTickets(MIXED, 'title').map((t) => t.label)).toEqual([
      'Enterprise license GA',
      'Implement Managed Agent',
      'Marketplace monetization',
      'Onboarding — first Agent',
      'SOC 2 Type I audit',
    ]);
  });

  it('linked keeps adapter order and still returns a copy', () => {
    const sorted = sortChatTickets(MIXED, 'linked');
    expect(sorted.map((t) => t.label)).toEqual(MIXED.map((t) => t.label));
    expect(sorted).not.toBe(MIXED);
  });

  it('does not mutate the input', () => {
    const input = MIXED.slice();
    sortChatTickets(input, 'open');
    expect(input.map((t) => t.label)).toEqual(MIXED.map((t) => t.label));
  });

  it('returns a copy for a single ticket or an empty list', () => {
    const one = [row('Only', 40)];
    expect(sortChatTickets(one, 'open')).not.toBe(one);
    expect(sortChatTickets(one, 'open')).toEqual(one);
    expect(sortChatTickets([], 'open')).toEqual([]);
  });
});

describe('isChatTicketComplete', () => {
  it('treats only 100% as complete', () => {
    expect(isChatTicketComplete(100)).toBe(true);
    expect(isChatTicketComplete(99)).toBe(false);
    expect(isChatTicketComplete(0)).toBe(false);
  });
});

describe('parseChatTicketSort', () => {
  it('accepts the four modes and falls back to open', () => {
    expect(parseChatTicketSort('open')).toBe('open');
    expect(parseChatTicketSort('done')).toBe('done');
    expect(parseChatTicketSort('title')).toBe('title');
    expect(parseChatTicketSort('linked')).toBe('linked');
    expect(parseChatTicketSort('nope')).toBe('open');
    expect(parseChatTicketSort('')).toBe('open');
  });
});
