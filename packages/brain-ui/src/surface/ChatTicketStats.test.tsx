import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatTicketStats, chatTicketStatsText } from './ChatTicketStats';
import { DEFAULT_CHAT_HISTORY_LABELS as L } from './ChatHistory';

/**
 * THE linked-ticket column every host's history row shows. One case per branch: absent is
 * unknown (no column), zero is "No tickets", open/done only when the server sent them and
 * they are not all cancelled, singular for one ticket, garbage counts render nothing.
 */
describe('chatTicketStatsText', () => {
  it('renders nothing when the host sent no rollup', () => {
    expect(chatTicketStatsText({}, L)).toBeNull();
    expect(chatTicketStatsText({ ticketCount: null }, L)).toBeNull();
  });

  it('renders nothing for a NaN or negative count', () => {
    expect(chatTicketStatsText({ ticketCount: Number.NaN, ticketProgressPct: 50 }, L)).toBeNull();
    expect(chatTicketStatsText({ ticketCount: -1, ticketProgressPct: 50 }, L)).toBeNull();
  });

  it('says "No tickets" (muted) when none are linked', () => {
    expect(chatTicketStatsText({ ticketCount: 0 }, L)).toEqual({ text: 'No tickets', aria: 'No tickets', empty: true });
  });

  it('shows the count only when there is no percent', () => {
    expect(chatTicketStatsText({ ticketCount: 8, ticketProgressPct: null }, L)?.text).toBe('8 tickets');
  });

  it('is singular for exactly one ticket', () => {
    expect(chatTicketStatsText({ ticketCount: 1 }, L)?.text).toBe('1 ticket');
  });

  it('shows percent with open and done when the server sent both', () => {
    expect(chatTicketStatsText({ ticketCount: 8, ticketProgressPct: 62.4, ticketOpenCount: 3, ticketDoneCount: 5 }, L)).toEqual({
      text: '62% · 3 open · 5 done',
      aria: '62% complete: 3 open and 5 done tickets',
      empty: false,
    });
  });

  it('falls back to the count form when open/done is unknown (older server)', () => {
    expect(chatTicketStatsText({ ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: 3 }, L)).toEqual({
      text: '62% · 8 tickets',
      aria: '62% complete across 8 tickets',
      empty: false,
    });
  });

  it('falls back to the count form when every linked ticket is cancelled', () => {
    expect(chatTicketStatsText({ ticketCount: 4, ticketProgressPct: 0, ticketOpenCount: 0, ticketDoneCount: 0 }, L)?.text).toBe(
      '0% · 4 tickets',
    );
  });

  it('treats NaN or negative open/done as unknown', () => {
    expect(chatTicketStatsText({ ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: Number.NaN, ticketDoneCount: 5 }, L)?.text).toBe(
      '62% · 8 tickets',
    );
    expect(chatTicketStatsText({ ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: 3, ticketDoneCount: -1 }, L)?.text).toBe(
      '62% · 8 tickets',
    );
  });
});

describe('<ChatTicketStats>', () => {
  it('announces once: a title, no aria-label, no role', () => {
    const html = renderToStaticMarkup(<ChatTicketStats chat={{ ticketCount: 8, ticketProgressPct: 62, ticketOpenCount: 3, ticketDoneCount: 5 }} labels={L} />);
    expect(html).toContain('title="62% complete: 3 open and 5 done tickets"');
    expect(html).not.toContain('aria-label');
    expect(html).not.toContain('role=');
    expect(html).toContain('>62% · 3 open · 5 done<');
  });

  it('renders nothing without a rollup', () => {
    expect(renderToStaticMarkup(<ChatTicketStats chat={{}} labels={L} />)).toBe('');
  });
});
