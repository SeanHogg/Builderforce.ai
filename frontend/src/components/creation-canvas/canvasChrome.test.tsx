import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  canvasChromeShows,
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

/** Every slot the registry declares. It was derived from the placement table; with that
 *  table gone it is stated once here, which is also the list a new slot has to join. */
const ALL_SLOTS = ['saveState', 'roster', 'surfaces', 'actions', 'handoff', 'surfaceControls', 'surfaceStatus'] as const;

describe('the canvas chrome rule', () => {
  it('keeps every status slot and drops every control when folded', () => {
    // Expanded, everything is on screen — a collapse that changes nothing when off
    // would make the whole table unfalsifiable.
    for (const slot of ['saveState', 'roster', 'surfaces', 'actions', 'handoff', 'surfaceControls', 'surfaceStatus'] as const) {
      expect(canvasChromeShows(slot, false)).toBe(true);
    }

    // What the canvas IS — kept.
    expect(canvasChromeShows('saveState', true)).toBe(true);
    expect(canvasChromeShows('roster', true)).toBe(true);
    expect(canvasChromeShows('surfaceStatus', true)).toBe(true);

    // What you DO to it — gone.
    expect(canvasChromeShows('surfaces', true)).toBe(false);
    expect(canvasChromeShows('actions', true)).toBe(false);
    expect(canvasChromeShows('handoff', true)).toBe(false);
    expect(canvasChromeShows('surfaceControls', true)).toBe(false);
  });

  /** The two halves of a runtime's contribution land on opposite sides on purpose: an
   *  app that is running has to keep saying so after its Run button is folded away. */
  it('splits a runtime\'s contribution across the rule rather than treating it as one thing', () => {
    expect(canvasChromeShows('surfaceControls', true)).toBe(false);
    expect(canvasChromeShows('surfaceStatus', true)).toBe(true);
  });

  /**
   * WHERE a slot is drawn is no longer this registry's question, and the tests that
   * asserted it went with the table.
   *
   * There used to be a `SLOT_PLACE` map and `canvasChromeSlotsIn(place)`, which the
   * command bar iterated so the bar's order was stated once rather than read off a column
   * of JSX. The bar has no linear order any more: its groups are the ARC, and that order
   * belongs to `CANVAS_BAR_GROUP_ORDER`. The roster and the doors out are contributions
   * INTO those groups rather than regions beside them, so a table naming a region per slot
   * was describing a layout that had stopped existing.
   *
   * What still has to hold is the property those placement tests were really protecting:
   * the things that survive a fold are the things a folded bar can still show.
   */
  it('spares exactly the three status slots when the bar folds', () => {
    const survivors = ALL_SLOTS.filter((slot) => canvasChromeShows(slot, true));
    expect([...survivors].sort()).toEqual(['roster', 'saveState', 'surfaceStatus']);
  });

  /** Publish is gated apart from the glyphs that act on the board — a word opens somewhere
   *  else, a glyph acts here — which is what lets the bar stand the doors out down on a
   *  fold while the roster beside them stays. */
  it('folds the door out of the canvas, and never the roster', () => {
    expect(canvasChromeShows('handoff', true)).toBe(false);
    expect(canvasChromeShows('actions', true)).toBe(false);
    expect(canvasChromeShows('roster', true)).toBe(true);
  });

  /**
   * THE CANVAS DOES NOT OFFER TO SAVE. Keeping a local board means taking an account,
   * and the header CTA already makes that offer — so a `save` slot here would be the
   * second bar on one screen saying the same word, which is what this registry exists
   * to prevent. `saveState` stays: reporting where the board lives is a FACT, and the
   * fact is not the offer.
   */
  it('has no save slot, because the header is the one place that offers to keep the work', () => {
    expect(ALL_SLOTS).not.toContain('save');
    expect(ALL_SLOTS).toContain('saveState');
  });
});

describe('the collapsed session bar', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** Expanded by default: a first-time visitor must not meet a canvas whose controls
   *  are already hidden behind a chevron they have never seen. */
  it('starts expanded and remembers the fold', () => {
    expect(readCanvasBarCollapsed()).toBe(false);
    writeCanvasBarCollapsed(true);
    // The key is a contract with every board already saved in a browser: renaming it
    // would expand every folded bar once. Spelled out here so that rename is a test.
    expect(window.localStorage.getItem('builderforce:create:barCollapsed')).toBe('true');
    expect(readCanvasBarCollapsed()).toBe(true);
    writeCanvasBarCollapsed(false);
    expect(readCanvasBarCollapsed()).toBe(false);
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. Folding the bar takes the surface switcher, Share and
   * every session action, and leaves the save state and the roster — the two things that
   * say whether this canvas is safe and who else is in it.
   */
  it('gives up the controls and keeps who is here', () => {
    render(<CreationCanvas sessionId="chrome-collapse-test" persistence="local" />);

    // Expanded: the switcher and Share are both reachable.
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('canvas-bar-collapse'));

    expect(screen.queryByRole('group', { name: 'Canvas view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite collaborators' })).toBeNull();

    // …and the status survives. The roster is the reason the rule exists — the pill
    // itself has nothing to say at rest any more (no ambient "Saved on this device"),
    // so it is not a fixture to assert on here.
    const roster = screen.getByLabelText('Active collaborators');
    expect(within(roster).getAllByRole('button').length).toBeGreaterThan(0);
    // The roster survives INSIDE the command bar — the element the collapse acts on —
    // which is the whole reason `canvasChrome.ts` places it there.
    expect(within(screen.getByTestId('canvas-command-bar')).getByLabelText('Active collaborators')).toBe(roster);
  });

  /**
   * ── THE ROW LIVES IN THE BAR ─────────────────────────────────────────────────────
   * The canvas used to float this card in the top-right corner (or portal it into
   * whichever header the shell had mounted) — two bars of controls in one corner,
   * which the operator read (correctly) as one thing drawn twice, and a row that read
   * differently signed in versus signed out because the two headers are structurally
   * different chromes. It draws inside `.commandBar` instead now, on every surface
   * with no header involved at all.
   */
  it('draws its doors-out row inside the command bar, on every surface', () => {
    render(<CreationCanvas sessionId="chrome-bar-test" persistence="local" />);

    const handoff = screen.getByTestId('canvas-handoff');
    expect(within(screen.getByTestId('canvas-command-bar')).getByTestId('canvas-handoff')).toBe(handoff);
    // Drawn ONCE, not duplicated by whatever renders around the canvas.
    expect(screen.getAllByTestId('canvas-handoff')).toHaveLength(1);
  });

  /**
   * Share draws as the roster's own trailing chip now, not a worded button inside
   * `handoff` beside Publish — so its panel has to anchor to ITS OWN row, not the
   * doors-out group at the other end of the bar, or the sheet would open off the
   * button that spawned it.
   */
  it('opens the invite sheet from the roster row, not the doors-out group', () => {
    render(<CreationCanvas sessionId="chrome-roster-invite-test" persistence="local" />);

    const rosterInvite = screen.getByTestId('canvas-roster-invite');
    expect(within(screen.getByTestId('canvas-command-bar')).getByTestId('canvas-roster-invite')).toBe(rosterInvite);
    expect(within(rosterInvite).getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
    expect(within(screen.getByTestId('canvas-handoff')).queryByRole('button', { name: 'Invite collaborators' })).toBeNull();

    fireEvent.click(within(rosterInvite).getByRole('button', { name: 'Invite collaborators' }));
    expect(within(rosterInvite).getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Invite collaborators' })).toBeInTheDocument();
  });
});
