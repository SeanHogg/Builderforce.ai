import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptUseCasePicker } from './PromptUseCasePicker';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string) => ({ tabLabel: 'Choose a starting point', heading: 'What should we create?' })[key] ?? key,
    { raw: () => [
      { label: 'Wireframe', prompt: 'Create a product wireframe.' },
      { label: 'Animation', prompt: 'Create an animation concept.' },
    ] },
  ),
}));

describe('PromptUseCasePicker', () => {
  it('renders the tab above a constrained prompt and returns the selected prescription', () => {
    const onSelect = vi.fn();
    const { container } = render(<PromptUseCasePicker placement="top" onSelect={onSelect} />);
    const root = container.firstElementChild!;
    const tab = screen.getByRole('button', { name: 'Choose a starting point' });

    expect(root.lastElementChild).toBe(tab);
    expect(screen.getByText('Wireframe').closest('button')).toHaveAttribute('tabindex', '-1');

    fireEvent.click(tab);
    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }));

    expect(onSelect).toHaveBeenCalledWith('Create a product wireframe.');
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes an expanded list with Escape', () => {
    render(<PromptUseCasePicker placement="bottom" onSelect={vi.fn()} />);
    const tab = screen.getByRole('button', { name: 'Choose a starting point' });
    fireEvent.click(tab);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });
});
