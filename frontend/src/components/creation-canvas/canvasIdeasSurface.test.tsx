import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// Real English copy: a button labelled "creationCanvas.surface.ideas.row.planInterview"
// tells nobody what it does, so the words are part of the assertion.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

import type { CreationNodeData } from './types';
import { CanvasIdeasSurface } from './CanvasIdeasSurface';

type Node = { id: string; data: CreationNodeData };
const idea = (id: string, data: Record<string, unknown> = {}): Node =>
  ({ id, data: { kind: 'idea', title: id, ...data } as CreationNodeData });

const BOARD: Node[] = [
  idea('Dog walking for towers', { capturedAt: '2026-09-14T09:00:00Z', stage: 'exploring', scratch: 'Dog walking for towers\nConcierge desks already get asked.' }),
  idea('Invoice chaser', { capturedAt: '2026-09-10T09:00:00Z', stage: 'validating', testedBy: ['Interview: Acme ops'] }),
  { id: 'iv', data: { kind: 'customerInterview', title: 'Interview: Acme ops' } as CreationNodeData },
  idea('Parked thing', { capturedAt: '2026-09-01T09:00:00Z', stage: 'parked' }),
];

function renderSurface(overrides: Partial<React.ComponentProps<typeof CanvasIdeasSurface>> = {}) {
  const props = {
    nodes: BOARD,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onOpenObject: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
  render(<CanvasIdeasSurface {...props} />);
  return props;
}

describe('the idea scratchpad', () => {
  /**
   * THE SURFACE HAS NO INPUT OF ITS OWN, AND THAT IS THE ASSERTION.
   *
   * Three tests used to live here — capture on click, capture on Ctrl+Enter, and a
   * disabled box for a viewer who cannot edit — because the scratchpad drew its own
   * textarea (`IdeaCaptureForm`) eight hundred pixels above the canvas's one composer.
   * Two boxes on one screen, both asking for a sentence, and nothing saying which one
   * the Enter key belonged to.
   *
   * The verb moved into the ONE composer as a surface-declared intent, so the capture
   * behaviour is asserted where it now lives: `CanvasComposer.test.tsx` pins that Enter
   * routes to `onCaptureIdea` and that a viewer who cannot edit is never offered the
   * verb, and `CreationCanvas.test.tsx` pins that the host turns that call into an
   * `idea` card on this board. What belongs HERE is that the second box is gone.
   */
  it('draws no text field of its own — the one composer captures', () => {
    renderSurface();
    // Not "the textarea is disabled" and not "the label reads differently": there is no
    // second box on the screen at all, which is the defect this closes.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Capture' })).toBeNull();
  });

  /** A viewer who cannot edit loses the VERB, not the list — the read-only sentence the
   *  old form carried has nothing left to explain, because there is no dead control for
   *  it to sit under. What they keep is every idea, and what they lose is the buttons
   *  that would write. */
  it('keeps the whole list for a viewer who cannot edit, and offers nothing that writes', () => {
    renderSurface({ onCreate: undefined, onUpdate: undefined });
    expect(screen.getAllByTestId('idea-log-row')).toHaveLength(3);
    expect(screen.queryByRole('textbox')).toBeNull();
    for (const button of screen.getAllByRole('button', { name: 'Plan an interview' })) expect(button).toBeDisabled();
  });

  it('lists ideas newest first and says which ones nobody has tested', () => {
    renderSurface();
    const titles = screen.getAllByTestId('idea-log-row').map((row) => within(row).getByRole('heading').textContent);
    expect(titles).toEqual(['Dog walking for towers', 'Invoice chaser', 'Parked thing']);
    // Only OPEN ideas with no evidence count — the parked one is a decision, not a gap.
    expect(screen.getByText('1 open idea has not been tested with a customer yet.')).toBeTruthy();
    // The evidence line is the card's own derivation, resolved against the board.
    const tested = screen.getAllByTestId('idea-log-row')[1]!;
    expect(within(tested).getByText('Tested by 1 interview and no experiments.')).toBeTruthy();
  });

  it('filters by pressing a stage in the distribution', () => {
    renderSurface();
    fireEvent.click(screen.getByRole('button', { name: /^Parked/ }));
    const rows = screen.getAllByTestId('idea-log-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByRole('heading').textContent).toBe('Parked thing');
    expect(screen.getByRole('button', { name: /^Parked/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('plans an interview: a linked customerInterview card, and the idea moves to validating', () => {
    const { onCreate, onUpdate } = renderSurface();
    const first = screen.getAllByTestId('idea-log-row')[0]!;
    fireEvent.click(within(first).getByRole('button', { name: 'Plan an interview' }));
    expect(onCreate).toHaveBeenCalledWith('customerInterview', { title: 'Interview: Dog walking for towers' });
    expect(onUpdate).toHaveBeenCalledWith('Dog walking for towers', {
      testedBy: ['Interview: Dog walking for towers'],
      stage: 'validating',
    });
  });

  it('moves an idea through its stages from the list', () => {
    const { onUpdate } = renderSurface();
    fireEvent.change(screen.getByLabelText('Stage of “Invoice chaser”'), { target: { value: 'validated' } });
    expect(onUpdate).toHaveBeenCalledWith('Invoice chaser', { stage: 'validated' });
  });

  it('opens an idea on the board, and hands the board back on Escape', () => {
    const { onOpenObject, onExit } = renderSurface();
    fireEvent.click(within(screen.getAllByTestId('idea-log-row')[2]!).getByRole('button', { name: 'Open on board' }));
    expect(onOpenObject).toHaveBeenCalledWith('Parked thing');
    fireEvent.keyDown(screen.getByTestId('canvas-ideas-surface'), { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
  });

  it('invites the first idea on an empty board, and points at the prompt for it', () => {
    renderSurface({ nodes: [] });
    expect(screen.getByText('No ideas yet')).toBeTruthy();
    expect(screen.queryByTestId('idea-log-row')).toBeNull();
    // The copy names WHERE to write, because the surface no longer has a box to point
    // at — an empty state that says "write one down" beside nothing to write in is the
    // half of this defect a reader would hit first.
    //
    // Matched on the EMPTY STATE's own opening words, not the bare phrase "in the prompt
    // below": the surface's lede carries that phrase too and is rendered on an empty
    // board as well, so the looser regex matched two paragraphs and threw.
    expect(screen.getByText(/^Jot the next idea you have in the prompt below/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
