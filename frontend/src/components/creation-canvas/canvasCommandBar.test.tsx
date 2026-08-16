import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

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
    // the regions `canvasChrome.ts` gives them, rather than deleted with it.
    expect(screen.getByTestId('canvas-session-pill')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-session-title')).toBeInTheDocument();
    expect(within(screen.getByTestId('canvas-handoff')).getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Canvas view' })).toBeInTheDocument();
  });

  /**
   * The whole point of the consolidation. Run is offered on the board because the board
   * is where somebody asks "how do I see this thing work" — the question this canvas
   * could not answer at all — and it stands down on a surface that runs itself rather
   * than drawing a second Run that can disagree with the first.
   */
  it('offers Run on a board with something to run, and never beside the App surface\'s own', () => {
    render(<CreationCanvas sessionId="command-bar-run" persistence="local" />);
    const bar = () => screen.getByTestId('canvas-command-bar');

    // A fresh board carries a Brain conversation and nothing else. That is objects
    // without an app, and a Run button over it is a promise with nothing behind it.
    expect(within(bar()).queryByTestId('canvas-run')).toBeNull();

    fireEvent.click(screen.getByTestId('canvas-quick-add-build'));
    fireEvent.click(within(screen.getByTestId('canvas-palette')).getByRole('button', { name: 'Code' }));

    const run = within(bar()).getByTestId('canvas-run');
    expect(run).toHaveTextContent('Run');
    // Named for WHAT it runs: a board can carry objects with Run buttons of their own,
    // and a bare "Run" beside them is ambiguous to anyone reading by name.
    expect(run).toHaveAccessibleName('Run this canvas');

    fireEvent.click(run);

    // It took us to the surface that runs it, and that surface contributes its own Run —
    // so the board's stands down rather than doubling up.
    expect(screen.getByRole('button', { name: 'App' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar()).queryByTestId('canvas-run')).toBeNull();
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

  it('opens the palette focused on the group its circle names', () => {
    render(<CreationCanvas sessionId="command-bar-quick-add" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-quick-add-agents'));
    const palette = screen.getByTestId('canvas-palette');

    // Focused, not filtered: the other groups fold rather than vanish, so nothing is
    // unreachable and the state is one the palette already persists and draws.
    expect(within(palette).getByRole('button', { name: 'Collapse Agents section' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(palette).getAllByRole('button', { name: /^Expand .* section$/ }).length).toBeGreaterThan(0);

    // …and the last circle brings all of them back.
    fireEvent.click(screen.getByTestId('canvas-quick-add-all'));
    expect(within(screen.getByTestId('canvas-palette')).queryByRole('button', { name: /^Expand .* section$/ })).toBeNull();
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
