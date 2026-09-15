import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

// Real English copy: a button labelled "creationCanvas.surface.ideas.capture.submit"
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
  it('captures a jotted line as an idea card on the board', () => {
    const { onCreate } = renderSurface();
    fireEvent.change(screen.getByLabelText('New idea'), { target: { value: 'Tool rental for renters\nweekend projects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(onCreate).toHaveBeenCalledWith('idea', expect.objectContaining({
      title: 'Tool rental for renters',
      scratch: 'Tool rental for renters\nweekend projects',
      stage: 'captured',
    }));
    // The box clears so the next thought can go straight in.
    expect((screen.getByLabelText('New idea') as HTMLTextAreaElement).value).toBe('');
  });

  it('captures on Ctrl+Enter, and never an empty card', () => {
    const { onCreate } = renderSurface();
    const box = screen.getByLabelText('New idea');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'Second idea' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onCreate).toHaveBeenCalledWith('idea', expect.objectContaining({ title: 'Second idea' }));
  });

  it('disables — never hides — capture for a viewer who cannot edit', () => {
    renderSurface({ onCreate: undefined, onUpdate: undefined });
    expect(screen.getByLabelText('New idea')).toBeDisabled();
    expect(screen.getByText('You can read these ideas, but only editors can add to this canvas.')).toBeTruthy();
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

  it('invites the first idea on an empty board', () => {
    renderSurface({ nodes: [] });
    expect(screen.getByText('No ideas yet')).toBeTruthy();
    expect(screen.queryByTestId('idea-log-row')).toBeNull();
  });
});
