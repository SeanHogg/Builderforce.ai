import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  CANVAS_BAR_COLLAPSED_KEY,
  canvasChromeKind,
  canvasChromePlace,
  canvasChromeShows,
  canvasChromeSlotsIn,
  canvasChromeStatusSlots,
  readCanvasBarCollapsed,
  writeCanvasBarCollapsed,
} from '@/lib/canvasChrome';
import { CreationCanvas } from './CreationCanvas';

/**
 * **Collapse hides controls, never status.**
 *
 * The rule the operator settled: a folded session bar keeps saying what the canvas is
 * doing — who is in it, whether the connection is live, whether a run is happening — and
 * gives up only the things you press. A collapsed roster is a team nobody can see is
 * working, and on a shared board that is somebody editing next to people they cannot see.
 *
 * These assert the table, and then assert that the bar actually obeys it — because a
 * rule that only the registry knows is a rule the header can quietly contradict.
 */

describe('the canvas chrome rule', () => {
  it('keeps every status slot and drops every control when folded', () => {
    // Expanded, everything is on screen — a collapse that changes nothing when off
    // would make the whole table unfalsifiable.
    for (const slot of ['title', 'saveState', 'roster', 'surfaces', 'actions', 'handoff', 'surfaceControls', 'surfaceStatus', 'save'] as const) {
      expect(canvasChromeShows(slot, false)).toBe(true);
    }

    // What the canvas IS — kept.
    expect(canvasChromeShows('title', true)).toBe(true);
    expect(canvasChromeShows('saveState', true)).toBe(true);
    expect(canvasChromeShows('roster', true)).toBe(true);
    expect(canvasChromeShows('surfaceStatus', true)).toBe(true);

    // What you DO to it — gone.
    expect(canvasChromeShows('surfaces', true)).toBe(false);
    expect(canvasChromeShows('actions', true)).toBe(false);
    expect(canvasChromeShows('handoff', true)).toBe(false);
    expect(canvasChromeShows('surfaceControls', true)).toBe(false);
    expect(canvasChromeShows('save', true)).toBe(false);
  });

  /** The two halves of a runtime's contribution land on opposite sides on purpose: an
   *  app that is running has to keep saying so after its Run button is folded away. */
  it('splits a runtime\'s contribution across the rule rather than treating it as one thing', () => {
    expect(canvasChromeKind('surfaceControls')).toBe('control');
    expect(canvasChromeKind('surfaceStatus')).toBe('status');
  });

  /** Derived from the one table, so "what survives" can be described without redrawing
   *  the bar — and so this list cannot drift from what `canvasChromeShows` returns. */
  it('lists exactly the slots that survive', () => {
    const survivors = canvasChromeStatusSlots();
    expect([...survivors].sort()).toEqual(['roster', 'saveState', 'surfaceStatus', 'title']);
    for (const slot of survivors) expect(canvasChromeShows(slot, true)).toBe(true);
  });
  /**
   * PLACEMENT IS DATA TOO, and every slot has exactly one home.
   *
   * The failure this forbids is a slot added to the kind table and forgotten in the
   * placement table: it would keep obeying the collapse rule perfectly and never be
   * drawn anywhere, which is the quietest possible way to lose a control.
   */
  it('gives every slot exactly one floating region', () => {
    const placed = (['pill', 'chips', 'topRight', 'bar'] as const).flatMap((place) => canvasChromeSlotsIn(place));
    expect([...placed].sort()).toEqual(
      ['actions', 'handoff', 'roster', 'saveState', 'surfaceControls', 'surfaceStatus', 'surfaces', 'save', 'title'].sort(),
    );
    // No slot in two regions.
    expect(new Set(placed).size).toBe(placed.length);
    for (const slot of placed) expect(canvasChromeSlotsIn(canvasChromePlace(slot))).toContain(slot);
  });

  /**
   * The roster is in the BAR, and that is the placement the whole rule rests on. It is
   * status, so it survives a collapse — and the bar is what a collapse leaves on screen,
   * so anywhere else and "the team stays visible" would be a statement about an element
   * that never folds in the first place.
   */
  it('puts every surviving control-bar slot where a collapse can be seen to spare it', () => {
    expect(canvasChromePlace('roster')).toBe('bar');
    expect(canvasChromePlace('surfaceStatus')).toBe('bar');
    for (const slot of canvasChromeSlotsIn('bar')) {
      if (canvasChromeKind(slot) === 'status') expect(canvasChromeShows(slot, true)).toBe(true);
    }
  });

  /** Share and Publish are placed apart from the glyphs because they ARE apart: a word
   *  opens somewhere else, a glyph acts here. */
  it('separates the two doors out of the canvas from the buttons that act on it', () => {
    expect(canvasChromePlace('handoff')).toBe('topRight');
    expect(canvasChromePlace('actions')).toBe('bar');
  });
});

describe('the collapsed session bar', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** Expanded by default: a first-time visitor must not meet a canvas whose controls
   *  are already hidden behind a chevron they have never seen. */
  it('starts expanded and remembers the fold', () => {
    expect(readCanvasBarCollapsed()).toBe(false);
    writeCanvasBarCollapsed(true);
    expect(window.localStorage.getItem(CANVAS_BAR_COLLAPSED_KEY)).toBe('true');
    expect(readCanvasBarCollapsed()).toBe(true);
    writeCanvasBarCollapsed(false);
    expect(readCanvasBarCollapsed()).toBe(false);
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. Folding the bar takes the surface switcher, Share and
   * every session action, and leaves the title and the roster — the two things that say
   * which canvas this is and who else is in it.
   */
  it('gives up the controls and keeps who is here', () => {
    render(<CreationCanvas sessionId="chrome-collapse-test" persistence="local" />);

    // Expanded: the switcher and Share are both reachable.
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('canvas-bar-collapse'));

    expect(screen.queryByRole('group', { name: 'Canvas view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();

    // …and the status survives. The roster is the reason the rule exists.
    expect(screen.getByTestId('canvas-session-title')).toBeInTheDocument();
    const roster = screen.getByLabelText('Active collaborators');
    expect(within(roster).getAllByRole('button').length).toBeGreaterThan(0);
    // The roster survives INSIDE the command bar — the element the collapse acts on —
    // which is the whole reason `canvasChrome.ts` places it there.
    expect(within(screen.getByTestId('canvas-command-bar')).getByLabelText('Active collaborators')).toBe(roster);
  });

  /** A collapse with no way back is a one-way door, so the toggle is the one control
   *  that is never folded away — and it says which direction it goes in. */
  it('never folds away its own toggle', () => {
    render(<CreationCanvas sessionId="chrome-toggle-test" persistence="local" />);
    const toggle = () => screen.getByTestId('canvas-bar-collapse');

    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).toHaveAccessibleName('Collapse the toolbar');

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveAccessibleName('Show the toolbar');

    fireEvent.click(toggle());
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});
