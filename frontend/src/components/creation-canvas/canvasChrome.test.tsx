import { readFile } from 'node:fs/promises';
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
import { CanvasChromeSlotProvider, CanvasChromeSlotTarget } from '@/lib/canvas/CanvasChromeSlot';
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
    for (const slot of ['title', 'saveState', 'roster', 'surfaces', 'actions', 'handoff', 'surfaceControls', 'surfaceStatus'] as const) {
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
      ['actions', 'handoff', 'roster', 'saveState', 'surfaceControls', 'surfaceStatus', 'surfaces', 'title'].sort(),
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

  /**
   * THE CANVAS DOES NOT OFFER TO SAVE. Keeping a local board means taking an account,
   * and the header CTA already makes that offer — so a `save` slot here would be the
   * second bar on one screen saying the same word, which is what this registry exists
   * to prevent. `saveState` stays: reporting where the board lives is a FACT, and the
   * fact is not the offer.
   */
  it('has no save slot, because the header is the one place that offers to keep the work', () => {
    const every = (['pill', 'chips', 'topRight', 'bar'] as const).flatMap((place) => canvasChromeSlotsIn(place));
    expect(every).not.toContain('save');
    expect(every).toContain('saveState');
  });
});

/**
 * THE SHARED PALETTE BLOCK PAINTS NOTHING.
 *
 * `.canvasPalette` exists so the handoff row keeps the board's tokens after it is
 * portalled into the application header, and it is a SECOND SELECTOR on the shell's
 * token block rather than a copy of it. That is right for custom properties and
 * catastrophic for anything else: for one release the block also carried
 * `background: var(--canvas-board-background)` and `height: calc(100vh - …)`, so the
 * portalled toolbar drew an opaque 360 x 1009 board-coloured panel over the canvas —
 * a floating row wearing the whole board's clothes, covering the surface switcher and
 * most of the objects.
 *
 * Read from the stylesheet rather than from a rendered element on purpose: jsdom does
 * not do layout, so the only way to catch "this rule paints" is to look at the rule.
 */
describe('the canvas palette shared with the header', () => {
  it('carries custom properties and nothing that paints or lays out', async () => {
    // Path from the vitest root (`frontend/`), not `import.meta.url`: the dom
    // environment rewrites module URLs to a non-file scheme and `readFile` refuses them.
    const css = await readFile('src/components/creation-canvas/CreationCanvas.module.css', 'utf8');
    const start = css.indexOf('.canvasShell,\n.canvasPalette {');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('\n}', start));

    const offenders = block
      .split('\n')
      .map((line) => line.trim())
      // Declarations only: skip the selector, comments and blank lines.
      .filter((line) => /^[a-z-]+ *:/i.test(line))
      .filter((line) => !line.startsWith('--'));
    expect(offenders).toEqual([]);
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
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('canvas-bar-collapse'));

    expect(screen.queryByRole('group', { name: 'Canvas view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();

    // …and the status survives. The roster is the reason the rule exists.
    expect(screen.getByTestId('canvas-session-title')).toBeInTheDocument();
    const roster = screen.getByLabelText('Active collaborators');
    expect(within(roster).getAllByRole('button').length).toBeGreaterThan(0);
    // The roster survives INSIDE the command bar — the element the collapse acts on —
    // which is the whole reason `canvasChrome.ts` places it there.
    expect(within(screen.getByTestId('canvas-command-bar')).getByLabelText('Active collaborators')).toBe(roster);
  });

  /**
   * ── THE ROW LIVES IN THE HEADER ────────────────────────────────────────────────
   * The canvas used to float its own card in the top-right corner, fourteen pixels
   * under an application header that ran the full width of the window — two bars of
   * controls in one corner, which the operator read (correctly) as one thing drawn
   * twice. The row is portalled into the header's slot instead.
   *
   * Asserted through the DOM rather than through a flag, because the whole claim is
   * about WHERE the node ends up.
   */
  it('hands its doors-out row to the header when the shell offers a slot', () => {
    render(
      <CanvasChromeSlotProvider>
        <header><CanvasChromeSlotTarget className="canvas-chrome-slot" /></header>
        <CreationCanvas sessionId="chrome-slot-test" persistence="local" />
      </CanvasChromeSlotProvider>,
    );

    const handoff = screen.getByTestId('canvas-handoff');
    expect(screen.getByTestId('canvas-chrome-slot')).toContainElement(handoff);
    expect(handoff).toHaveAttribute('data-hosted', 'header');
    // The rest of the canvas chrome is UNMOVED. Only the handoff row was portalled, so
    // the surface switcher and the session pill stay where they float on the board —
    // asserted here because "I extracted the right subtree" is otherwise invisible until
    // someone opens the app and finds the top of the canvas empty.
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
    expect(screen.getByTestId('canvas-session-title')).toBeInTheDocument();
    // Drawn ONCE. A portal that left a copy behind would be the two bars again.
    expect(screen.getAllByTestId('canvas-handoff')).toHaveLength(1);

    // …and it still WORKS from up there: the share panel is a child of the row, so it
    // anchors to the button that opened it wherever that button was drawn.
    fireEvent.click(within(handoff).getByRole('button', { name: 'Invite' }));
    expect(within(handoff).getByRole('dialog', { name: 'Invite collaborators' })).toBeInTheDocument();
  });

  /**
   * ONE BOARD PUBLISHES, however many are mounted.
   *
   * `CanvasStage` keeps every opened board mounted and hides all but the selected one
   * with `visibility: hidden`, so switching boards does not throw away the state of the
   * one you left. A PORTAL escapes that: `visibility` inherits down the DOM and the
   * portalled row is a child of the header, not of the box that was hidden. Three cached
   * boards therefore put three live copies of Make it real / Invite / Publish in the
   * header — the exact duplication this whole seam exists to remove, reintroduced by the
   * mechanism that removed it.
   */
  it('publishes only the board on stage, however many are kept mounted behind it', () => {
    render(
      <CanvasChromeSlotProvider>
        <header><CanvasChromeSlotTarget className="canvas-chrome-slot" /></header>
        <CreationCanvas sessionId="chrome-slot-cached-board" persistence="local" stageActive={false} />
        <CreationCanvas sessionId="chrome-slot-staged-board" persistence="local" stageActive />
      </CanvasChromeSlotProvider>,
    );

    const slot = screen.getByTestId('canvas-chrome-slot');
    const hosted = screen.getAllByTestId('canvas-handoff').filter((row) => slot.contains(row));
    expect(hosted).toHaveLength(1);
    // The cached board keeps its own row in its own corner, where its container's
    // `visibility: hidden` can still reach it.
    const inCorner = screen.getAllByTestId('canvas-handoff').filter((row) => !slot.contains(row));
    expect(inCorner).toHaveLength(1);
    expect(inCorner[0]).toHaveAttribute('data-hosted', 'canvas');
  });

  /**
   * The fallback is not a nicety — the VS Code webview, the `/embed` tree and every
   * component test render the canvas with no header above it. A surface must not lose
   * its only route to Invite and Publish by having nowhere to consolidate into.
   */
  it('keeps the row in its own corner on a surface that offers no header', () => {
    render(<CreationCanvas sessionId="chrome-slot-fallback-test" persistence="local" />);

    const handoff = screen.getByTestId('canvas-handoff');
    expect(handoff).toHaveAttribute('data-hosted', 'canvas');
    expect(screen.queryByTestId('canvas-chrome-slot')).toBeNull();
    expect(within(handoff).getByRole('button', { name: 'Invite' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });
});
