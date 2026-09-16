import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TicketParentLine } from './TicketParentLine';
import { DEFAULT_CHAT_TICKETS_LABELS } from './types';

/**
 * THE RAIL HAS TO SAY WHICH EPIC A TICKET BELONGS TO.
 *
 * A Brain chat that spawned an epic, a research epic, three child epics and their
 * tasks showed all of them as the same chip — "EPIC · BACKLOG · SPAWNED HERE" — so
 * the hierarchy it had just created could not be told apart. These lock the three
 * things that fix costs: the parent is NAMED, a ticket without one renders nothing
 * at all (no empty row, no placeholder), and the line is a link only when the host
 * can actually route it.
 */

const inParent = DEFAULT_CHAT_TICKETS_LABELS.inParent;

describe('<TicketParentLine>', () => {
  it('names the parent work item', () => {
    const html = renderToStaticMarkup(
      <TicketParentLine parent={{ kind: 'epic', ref: '2522', label: 'Advisor Platform' }} inParent={inParent} />,
    );
    expect(html).toContain('in Advisor Platform');
    expect(html).toContain('↳');
  });

  it('renders NOTHING for a top-level ticket', () => {
    // Not an empty row and not a placeholder: a ticket with no parent must look
    // exactly as it did before, so the panel needs no `hasParent` branch of its own.
    expect(renderToStaticMarkup(<TicketParentLine inParent={inParent} />)).toBe('');
    expect(renderToStaticMarkup(<TicketParentLine parent={null} inParent={inParent} />)).toBe('');
  });

  it('carries the full parent title as a tooltip, because the chip column ellipsises it', () => {
    const long = 'Advisor Platform — marketplace, matching, scheduling and billing';
    const html = renderToStaticMarkup(
      <TicketParentLine parent={{ kind: 'epic', ref: '2522', label: long }} inParent={inParent} />,
    );
    expect(html).toContain(`title="in ${long}"`);
    expect(html).toContain('ellipsis');
  });

  it('is plain text when the host cannot route the parent', () => {
    const html = renderToStaticMarkup(
      <TicketParentLine parent={{ kind: 'epic', ref: '2522', label: 'Advisor Platform' }} inParent={inParent} />,
    );
    expect(html).not.toContain('<button');
  });

  it('becomes a button when the host can open the parent', () => {
    const onOpen = vi.fn();
    const html = renderToStaticMarkup(
      <TicketParentLine
        parent={{ kind: 'epic', ref: '2522', label: 'Advisor Platform' }}
        inParent={inParent}
        onOpen={onOpen}
        openTitle="Open"
      />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('Open · Advisor Platform');
  });

  it('localizes the whole phrase, not just the noun', () => {
    const html = renderToStaticMarkup(
      <TicketParentLine parent={{ kind: 'epic', ref: '2522', label: 'Plateforme' }} inParent={(p) => `dans ${p}`} />,
    );
    expect(html).toContain('dans Plateforme');
    expect(html).not.toContain('in Plateforme');
  });
});
