import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import { canvasApp } from '@/lib/canvasApp';
import { CANVAS_QUICK_ADD } from '@/lib/canvasQuickAdd';
import { CREATION_PALETTE_GROUPS } from './creationObjectRegistry';
import { CreationCanvas } from './CreationCanvas';

/**
 * THE ONE BAR.
 *
 * The canvas used to spend a 54px chrome band, a floating rail and a phone action column
 * on controls, and split "what can I do" across all three. Everything now floats over a
 * full-bleed board, and everything you DO lives in one card at the bottom.
 *
 * These assert the two properties that make that a consolidation rather than a
 * relocation: the bar's contents follow the SURFACE, and the shortlist of coloured
 * circles points into the object registry instead of carrying a second copy of it.
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
   * The circles are a SHORTLIST INTO the palette, never a second catalogue beside it.
   * A hand-written bar menu is the version of this that goes stale the first time a kind
   * is added to the registry and not to the bar.
   */
  it('points its circles at real palette groups and keeps a door to the rest', () => {
    const groups = new Set(CREATION_PALETTE_GROUPS.map((entry) => entry.group));
    for (const entry of CANVAS_QUICK_ADD) {
      if (entry.group) expect(groups.has(entry.group)).toBe(true);
    }
    // Exactly one entry opens the palette whole. Without it a six-item shortlist would be
    // the only way into a sixteen-group catalogue.
    expect(CANVAS_QUICK_ADD.filter((entry) => !entry.group)).toHaveLength(1);
  });

  /**
   * ONE picker, two doors. The circles and a node's centre `+` open the SAME component,
   * which is what stops "choose an object" being two interactions with two searches and
   * two ideas of what exists.
   */
  it('opens the shared picker on the group its circle names', () => {
    render(<CreationCanvas sessionId="command-bar-quick-add" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-quick-add-agents'));
    const picker = screen.getByTestId('canvas-object-picker');

    // Opened ON the group, and the rail offers every other one — so a six-circle
    // shortlist is a shortcut into the catalogue and never the boundary of it.
    expect(within(picker).getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(picker).getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(picker).getByTestId('canvas-picker-agent')).toBeInTheDocument();
    // A kind from another group is NOT listed while a group is open...
    expect(within(picker).queryByTestId('canvas-picker-website')).toBeNull();

    // ...but searching ignores the open group on purpose. Somebody who opens Agents and
    // types "website" wants the website, not an empty list.
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

    fireEvent.click(screen.getByTestId('canvas-quick-add-build'));
    fireEvent.click(within(screen.getByTestId('canvas-object-picker')).getByTestId('canvas-picker-website'));

    expect(websites()).toBe(before + 1);
    // It closes behind itself — a picker that stays open over the thing it just made is
    // a picker in the way.
    expect(screen.queryByTestId('canvas-object-picker')).toBeNull();
  });

  /** The circles add OBJECTS, so they belong to a surface that HAS objects. Over a
   *  conversation they are six controls whose only possible answer is nothing. */
  it('takes its object circles away on a surface with no board', () => {
    render(<CreationCanvas sessionId="command-bar-surface" persistence="local" />);
    expect(screen.getByTestId('canvas-quick-add-build')).toBeInTheDocument();

    // Through the chip group specifically: "Chat" also names a board object's own
    // control, and a bare role+name query would pick whichever came first.
    fireEvent.click(within(screen.getByRole('group', { name: 'Canvas view' })).getByRole('button', { name: 'Chat' }));
    expect(screen.queryByTestId('canvas-quick-add-build')).toBeNull();
    // The bar itself stays — a surface never loses its bar, only its bar's contents.
    expect(screen.getByTestId('canvas-command-bar')).toBeInTheDocument();
  });
});
