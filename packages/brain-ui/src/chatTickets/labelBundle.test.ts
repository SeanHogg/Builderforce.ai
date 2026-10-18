import { describe, expect, it } from 'vitest';
import { chatTicketsLabelsFromBundle } from './labelBundle';
import { DEFAULT_CHAT_TICKETS_LABELS } from './types';

describe('chatTicketsLabelsFromBundle', () => {
  it('reads static fields, tier names and templates from the bundle', () => {
    const labels = chatTicketsLabelsFromBundle({
      'ct.sortLabel': 'Tickets sortieren',
      'ct.kind.epic': 'Epos',
      'ct.ringAria': '{label}: {pct}% erledigt',
      'ct.ticketCountOne': '{n} Ticket',
      'ct.ticketCountMany': '{n} Tickets',
    });
    expect(labels.sortLabel).toBe('Tickets sortieren');
    expect(labels.kind.epic).toBe('Epos');
    expect(labels.ringAria('A', 40)).toBe('A: 40% erledigt');
    expect(labels.ticketCount(1)).toBe('1 Ticket');
    expect(labels.ticketCount(3)).toBe('3 Tickets');
  });

  it('keeps the English default for anything the bundle lacks', () => {
    const labels = chatTicketsLabelsFromBundle({});
    expect(labels.sortOpen).toBe(DEFAULT_CHAT_TICKETS_LABELS.sortOpen);
    expect(labels.kind.task).toBe(DEFAULT_CHAT_TICKETS_LABELS.kind.task);
    expect(labels.mergedN(2)).toBe(DEFAULT_CHAT_TICKETS_LABELS.mergedN(2));
  });

  it('binds the original-request label (static) and its template (parametric)', () => {
    const labels = chatTicketsLabelsFromBundle({
      'ct.originalRequest': 'Ursprüngliche Anfrage',
      'ct.originalRequestText': 'Ursprüngliche Anfrage: {text}',
    });
    expect(labels.originalRequest).toBe('Ursprüngliche Anfrage');
    expect(labels.originalRequestText('Rewrite the billing webhook'))
      .toBe('Ursprüngliche Anfrage: Rewrite the billing webhook');
  });

  it('falls back to the English default for the original-request pair', () => {
    const labels = chatTicketsLabelsFromBundle({});
    expect(labels.originalRequest).toBe(DEFAULT_CHAT_TICKETS_LABELS.originalRequest);
    expect(labels.originalRequestText('hello'))
      .toBe(DEFAULT_CHAT_TICKETS_LABELS.originalRequestText('hello'));
  });
});
