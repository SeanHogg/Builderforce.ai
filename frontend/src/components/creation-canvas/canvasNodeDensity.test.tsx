import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import {
  CANVAS_NODE_DENSITIES,
  DEFAULT_CANVAS_NODE_DENSITY,
  canvasNodeDensity,
  canvasNodeDensityActionKey,
  nextCanvasNodeDensity,
} from '@/lib/canvasNodeDensity';
import { CreationCanvas } from './CreationCanvas';

/**
 * "We still want the board to be visual but to include a way to minimize and then
 * preview/expand. Not all nodes need to be the full view."
 *
 * Every card drew its full body, always — right for the two or three objects somebody is
 * working on and wrong for the twenty behind them. These assert the rule, and then assert
 * that a card actually obeys it.
 */

describe('node density', () => {
  /** Derived, never written: an object authored by Brain, imported from a template, or
   *  created before this existed has no `density` and must still draw. */
  it('defaults to the full body without a migration', () => {
    expect(DEFAULT_CANVAS_NODE_DENSITY).toBe('expanded');
    expect(canvasNodeDensity({ kind: 'note', title: 'x' })).toBe('expanded');
    // Node data is authored by models and templates as well as by people. A typo reads as
    // the default rather than throwing — a board with one card too big beats a board that
    // fails to render.
    expect(canvasNodeDensity({ density: 'tiny' })).toBe('expanded');
    expect(canvasNodeDensity({ density: 42 })).toBe('expanded');
  });

  /** It SHRINKS first. You reach for this control when a card is in the way, and a toggle
   *  whose first press makes it bigger is a toggle pressed once and abandoned. */
  it('cycles toward smaller first and returns', () => {
    expect(nextCanvasNodeDensity('expanded')).toBe('preview');
    expect(nextCanvasNodeDensity('preview')).toBe('minimized');
    expect(nextCanvasNodeDensity('minimized')).toBe('expanded');

    // Every value is reachable from every other, so no density is a dead end.
    const seen = new Set<string>();
    let at = DEFAULT_CANVAS_NODE_DENSITY;
    for (let step = 0; step < CANVAS_NODE_DENSITIES.length; step += 1) {
      seen.add(at);
      at = nextCanvasNodeDensity(at);
    }
    expect([...seen].sort()).toEqual([...CANVAS_NODE_DENSITIES].sort());
    expect(at).toBe(DEFAULT_CANVAS_NODE_DENSITY);
  });

  /** The label names what the NEXT press does, so the control is readable before it is
   *  pressed rather than after. */
  it('names the destination, not the current state', () => {
    expect(canvasNodeDensityActionKey('expanded')).toBe('toPreview');
    expect(canvasNodeDensityActionKey('preview')).toBe('toMinimized');
    expect(canvasNodeDensityActionKey('minimized')).toBe('toExpanded');
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. A minimised card is an ORB: the mark, the name and the
   * connectors, with no body at all — and its body is ABSENT rather than hidden, because
   * React Flow measures what is rendered and a hidden card still reserves a card's worth
   * of graph.
   */
  it('draws a card down to an orb and back', () => {
    render(<CreationCanvas sessionId="node-density-test" persistence="local" />);

    fireEvent.click(screen.getByTestId('canvas-quick-add-build'));
    fireEvent.click(screen.getByTestId('canvas-picker-code'));

    const card = () => screen.getByTestId('canvas-node-code');
    expect(card()).toHaveAttribute('data-density', 'expanded');
    const nodeId = card().getAttribute('data-node-id')!;
    const toggle = () => screen.getByTestId(`canvas-node-density-${nodeId}`);
    // The attribute rather than `toHaveAccessibleName`: React Flow renders its nodes
    // inside a subtree that `dom-accessibility-api` treats as hidden under jsdom, where
    // there is no layout, so the computed name comes back empty for every card control.
    // The label is what ships, so the label is what is asserted.
    expect(toggle()).toHaveAttribute('aria-label', 'Show less of this object');

    fireEvent.click(toggle());
    expect(card()).toHaveAttribute('data-density', 'preview');
    expect(toggle()).toHaveAttribute('aria-label', 'Minimise to a mark');

    fireEvent.click(toggle());
    // The orb: the title survives, the body does not.
    expect(card()).toHaveAttribute('data-density', 'minimized');
    expect(within(card()).getByText('Code workspace')).toBeInTheDocument();
    expect(card().querySelector('[class*="nodeBody"]')).toBeNull();
    expect(toggle()).toHaveAttribute('aria-label', 'Show the whole object');

    fireEvent.click(toggle());
    expect(card()).toHaveAttribute('data-density', 'expanded');
  });
});
