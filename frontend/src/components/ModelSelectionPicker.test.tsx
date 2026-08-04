import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSelectionPicker, type ChatModelOptions } from './ModelSelectionPicker';

const options: ChatModelOptions = {
  configured: [{ id: 'tenant_model:reviewer', label: 'Review specialist' }],
  byo: [{ id: 'direct/kimi-code/kimi-k2.5', vendor: 'Kimi Code' }],
  free: ['free/qwen'],
  plan: ['free/qwen', 'plan/sonnet'],
  paid: [{ id: 'openrouter/paid-opus', cost: '$15.00 input / $75.00 output per 1M tokens + $0.01/request' }],
};

describe('ModelSelectionPicker', () => {
  it('filters by funding category and selects a strict model choice', () => {
    const onChange = vi.fn();
    render(<ModelSelectionPicker selection={{ mode: 'auto' }} options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    fireEvent.click(screen.getByRole('button', { name: 'BYO' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('BYO pool')).toBeTruthy();
    expect(within(list).getByText('direct/kimi-code/kimi-k2.5')).toBeTruthy();
    expect(within(list).queryByText('free/qwen')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), { target: { value: 'k2.5' } });
    fireEvent.click(within(list).getByText('direct/kimi-code/kimi-k2.5'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'model', model: 'direct/kimi-code/kimi-k2.5' });
  });

  it('exposes Free, Plan, Paid, BYO, and Configured filters when populated', () => {
    render(<ModelSelectionPicker selection={{ mode: 'auto' }} options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    const filters = screen.getByLabelText('Filter models');
    for (const label of ['Free', 'Plan', 'Paid', 'BYO', 'Configured']) {
      expect(within(filters).getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('puts BuilderForce collections first, preserves BYO order, and displays paid cost', () => {
    render(<ModelSelectionPicker selection={{ mode: 'auto' }} options={{
      ...options,
      byo: [
        { id: 'direct/meta/llama', vendor: 'Meta' },
        { id: 'claude-opus', vendor: 'Anthropic' },
      ],
    }} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    const choices = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(choices.map((choice) => choice.textContent)).toEqual([
      expect.stringContaining('Auto'),
      expect.stringContaining('free/qwen'),
      expect.stringContaining('plan/sonnet'),
      expect.stringContaining('openrouter/paid-opus'),
      expect.stringContaining('BYO pool'),
      expect.stringContaining('direct/meta/llama'),
      expect.stringContaining('claude-opus'),
      expect.stringContaining('Review specialist'),
    ]);
    expect(screen.getByText('$15.00 input / $75.00 output per 1M tokens + $0.01/request')).toBeTruthy();
  });
});
