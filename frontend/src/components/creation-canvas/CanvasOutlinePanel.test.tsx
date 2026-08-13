import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasOutlinePanel } from './CanvasOutlinePanel';
import type { CreationFlowNode } from './CreationNode';

/**
 * The gap these cover: the canvas had one search box and it filtered the PALETTE
 * of object types you can add, not the objects on the board. The outline listed
 * every node in insertion order with no search and no filter, so past roughly
 * thirty objects "where is the pricing deck" had no answer but scrolling.
 */

/** Real catalogs, resolved as next-intl resolves them, so these assert the
 *  strings a person actually reads rather than key names. */
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const node = (id: string, kind: string, title: string, status?: string): CreationFlowNode => ({
  id, type: 'creation', position: { x: 0, y: 0 },
  data: { kind, title, ...(status ? { status } : {}) },
} as CreationFlowNode);

const board = [
  node('1', 'task', 'Ship the pricing page', 'in_progress'),
  node('2', 'slides', 'Pricing deck', 'Draft'),
  node('3', 'task', 'Fix login redirect', 'blocked'),
  node('4', 'document', 'Runbook'),
];

function renderPanel(nodes = board) {
  const onFocus = vi.fn();
  render(<CanvasOutlinePanel nodes={nodes} edges={[]} onFocus={onFocus} onClose={vi.fn()} />);
  return { onFocus };
}

const listedTitles = () =>
  within(screen.getByRole('list', { name: '' }) ?? document.body).queryAllByRole('button')
    .map((button) => button.textContent ?? '');

describe('CanvasOutlinePanel', () => {
  it('lists every object in board order before anything is typed', () => {
    renderPanel();
    expect(screen.getByText(/Showing 4 of 4/)).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items[0]).toContain('Ship the pricing page');
    expect(items[3]).toContain('Runbook');
  });

  it('narrows the board to a text query and says how many are showing', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this board' }), { target: { value: 'pricing' } });
    expect(screen.getByText(/Showing 2 of 4/)).toBeInTheDocument();
    expect(screen.queryByText(/Runbook/)).toBeNull();
  });

  it('puts the best match first — a title prefix beats a mid-title hit', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this board' }), { target: { value: 'pricing' } });
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items[0]).toContain('Pricing deck');
    expect(items[1]).toContain('Ship the pricing page');
  });

  it('offers a chip per kind actually on the board, most-used first, and filters by it', () => {
    renderPanel();
    const chips = within(screen.getByRole('group', { name: 'Filter by object type' })).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['All 4', 'Task 2', 'Document 1', 'Slides 1']);
    fireEvent.click(screen.getByRole('button', { name: 'Task 2' }));
    expect(screen.getByText(/Showing 2 of 4/)).toBeInTheDocument();
    expect(screen.queryByText(/Runbook/)).toBeNull();
  });

  it('combines the chip and the query', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Task 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this board' }), { target: { value: 'pricing' } });
    expect(screen.getByText(/Showing 1 of 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ship the pricing page/ })).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than looking like an empty board', () => {
    renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this board' }), { target: { value: 'zzzz' } });
    expect(screen.getByText('No objects match that search.')).toBeInTheDocument();
    expect(screen.queryByText('This canvas has no objects yet.')).toBeNull();
  });

  it('shows the empty state and no search control on an empty board', () => {
    renderPanel([]);
    expect(screen.getByText('This canvas has no objects yet.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Search this board' })).toBeNull();
  });

  it('focuses the object a result is clicked on', () => {
    const { onFocus } = renderPanel();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search this board' }), { target: { value: 'runbook' } });
    fireEvent.click(screen.getByRole('button', { name: /Runbook/ }));
    expect(onFocus).toHaveBeenCalledWith('4');
  });

  it('announces the result count politely so a screen reader hears it change', () => {
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Showing 4 of 4');
  });
});
