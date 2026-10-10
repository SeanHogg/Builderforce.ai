import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/templates/useTemplateCatalog', () => ({ useTemplateCatalog: () => [] }));

/**
 * The two things every prompt offers, the same way on every surface: starting points
 * from `+`, opened INSIDE the box, and fixed next-step chips above an empty box.
 */
describe('ChatInput — starting points and next steps', () => {
  const chips = [{ id: 'polish', label: 'Polish the design', onSelect: vi.fn() }];

  it('draws the chips only while the box is empty and nothing is running', () => {
    const { rerender } = render(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} suggestions={chips} />);
    expect(screen.getByRole('button', { name: 'Polish the design' })).toBeInTheDocument();

    rerender(<ChatInput value="typing" onChange={() => {}} onSubmit={() => {}} suggestions={chips} />);
    expect(screen.queryByRole('button', { name: 'Polish the design' })).toBeNull();

    rerender(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} running onStop={() => {}} suggestions={chips} />);
    expect(screen.queryByRole('button', { name: 'Polish the design' })).toBeNull();
  });

  it('a chip seeds, it never sends', () => {
    const onSubmit = vi.fn();
    const onSelect = vi.fn();
    render(<ChatInput value="" onChange={() => {}} onSubmit={onSubmit} suggestions={[{ id: 'x', label: 'Add a section', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a section' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers starting points from `+` even on a prompt that takes no files', () => {
    render(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} starters={{ onSelect: vi.fn() }} />);
    expect(screen.queryByTestId('composer-starters')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'chatInput.add' }));
    expect(screen.queryByRole('menuitem', { name: 'chatInput.upload' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'chatInput.startingPoints' }));
    expect(screen.getByRole('textbox').closest('form')).toContainElement(screen.getByTestId('composer-starters'));
  });

  it('draws no `+` at all when there is nothing to add', () => {
    render(<ChatInput value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: 'chatInput.add' })).toBeNull();
  });
});
