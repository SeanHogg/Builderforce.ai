import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { canvasApp } from '@/lib/canvasApp';
import { CreationCanvas } from './CreationCanvas';

/**
 * THE ONE BAR.
 *
 * The canvas used to spend a 54px chrome band, a floating rail and a phone action column
 * on controls, and split "what can I do" across all three. Everything now floats over a
 * full-bleed board, and everything you DO lives in one card at the bottom.
 *
 * These assert the two properties that make that a consolidation rather than a
 * relocation: the bar's contents follow the SURFACE, and "add to the board" is ONE door
 * into the object registry rather than a shortlist that could drift from it.
 */

describe('the floating command bar', () => {
  it('is one bar, and the chrome band it replaced is gone', () => {
    render(<CreationCanvas sessionId="command-bar-one" persistence="local" />);

    expect(screen.getAllByTestId('canvas-command-bar')).toHaveLength(1);
    // The pieces the band used to hold are still here — sorted by what they SAY, into
    // the regions `canvasChrome.ts` gives them, rather than deleted with it. (The
    // session pill is one of those pieces too, but it has nothing to say at rest —
    // no ambient "Saved on this device" — so there is nothing to assert on here.)
    // Invite draws as the roster's own trailing chip now, not inside `canvas-handoff`
    // beside Publish — see `canvasChrome.test.tsx` for the dedicated coverage of that.
    expect(within(screen.getByTestId('canvas-roster-invite')).getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
  });

  /**
   * The whole point of the consolidation. Run is offered on the board because the board
   * is where somebody asks "how do I see this thing work" — the question this canvas
   * could not answer at all, and the one the entire redesign started from.
   *
   * The gate is the APP PROJECTION, not the object count: a board holding a Brain
   * conversation and three notes has plenty of objects and nothing to run, and a Run
   * button over it is a promise that lands on an empty frame.
   */
  it('gates Run on there being an app, not on there being objects', () => {
    const note = { id: 'n1', data: { kind: 'note', title: 'Ideas' } };
    const draft = { id: 'n2', data: { kind: 'code', title: 'Notes', code: 'const x = 1;' } };
    const page = { id: 'n3', data: { kind: 'code', path: 'index.html', code: '<h1>Live</h1>' } };

    // Objects, and even source, are not an app: a lone module has no page to open.
    expect(canvasApp([note]).entry).toBeNull();
    expect(canvasApp([note, draft]).entry).toBeNull();
    // A page is.
    expect(canvasApp([note, draft, page]).entry?.path).toBe('index.html');
  });

  it('offers no Run over a board that builds nothing yet', () => {
    render(<CreationCanvas sessionId="command-bar-run" persistence="local" />);

    // A fresh board carries a Brain conversation and nothing else.
    expect(within(screen.getByTestId('canvas-command-bar')).queryByTestId('canvas-run')).toBeNull();
  });

  /**
   * ONE picker, two doors. The button and a node's centre `+` open the SAME component,
   * which is what stops "choose an object" being two interactions with two searches and
   * two ideas of what exists. This used to be six circles — five that pre-filtered a
   * group by colour alone, plus a sixth that opened everything — but a dot with no
   * glyph told nobody what it did, so the shortlist collapsed into its own "everything"
   * door and the picker's own rail is what still narrows to one group.
   */
  it('opens the shared picker on every group, and its own rail still narrows to one', () => {
    render(<CreationCanvas sessionId="command-bar-quick-add" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-quick-add'));
    const picker = screen.getByTestId('canvas-object-picker');

    // No pre-filter: the one button always opens on every group.
    expect(within(picker).getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');

    // The rail is where narrowing still happens — the shortlist's circles pointed here,
    // and removing them did not remove the destination.
    fireEvent.click(within(picker).getByRole('button', { name: 'Agents' }));
    expect(within(picker).getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(picker).getByTestId('canvas-picker-agent')).toBeInTheDocument();
    // A kind from another group is NOT listed while a group is open...
    expect(within(picker).queryByTestId('canvas-picker-website')).toBeNull();

    // ...but searching ignores the open group on purpose. Somebody who narrows to Agents
    // and types "website" wants the website, not an empty list.
    fireEvent.change(within(picker).getByRole('textbox'), { target: { value: 'website' } });
    expect(within(picker).getByTestId('canvas-picker-website')).toBeInTheDocument();
  });

  it('adds the object the picker was asked for', () => {
    render(<CreationCanvas sessionId="command-bar-pick" persistence="local" />);
    // Counted, not asserted-present: a new session is seeded with demo objects and one of
    // them is already a website, so "there is a website on the board" was true before the
    // press and would have passed whether or not the picker did anything.
    const websites = () => document.querySelectorAll('[data-node-kind="website"]').length;
    const before = websites();

    fireEvent.click(screen.getByTestId('canvas-quick-add'));
    fireEvent.click(within(screen.getByTestId('canvas-object-picker')).getByTestId('canvas-picker-website'));

    expect(websites()).toBe(before + 1);
    // It closes behind itself — a picker that stays open over the thing it just made is
    // a picker in the way.
    expect(screen.queryByTestId('canvas-object-picker')).toBeNull();
  });

  /** The button adds OBJECTS, so it belongs to a surface that HAS objects. Over a
   *  conversation it is one control whose only possible answer is nothing. */
  it('takes its add-object button away on a surface with no board', () => {
    render(<CreationCanvas sessionId="command-bar-surface" persistence="local" />);
    expect(screen.getByTestId('canvas-quick-add')).toBeInTheDocument();

    // Through the chip group specifically: "Chat" also names a board object's own
    // control, and a bare role+name query would pick whichever came first.
    fireEvent.click(within(screen.getByRole('group', { name: 'Canvas view' })).getByRole('button', { name: 'Chat' }));
    expect(screen.queryByTestId('canvas-quick-add')).toBeNull();
    // The bar itself stays — a surface never loses its bar, only its bar's contents.
    expect(screen.getByTestId('canvas-command-bar')).toBeInTheDocument();
  });
});
