import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatInput, type ChatModelOptions } from './ChatInput';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const options: ChatModelOptions = {
  configured: [{ id: 'tenant_model:reviewer', label: 'Review specialist' }],
  byo: [{ id: 'direct/kimi-code/kimi-k2.5', vendor: 'Kimi Code' }],
  free: ['free/qwen'],
  plan: ['free/qwen', 'plan/sonnet'],
  paid: [{ id: 'openrouter/paid-opus', cost: '$15.00 input / $75.00 output per 1M tokens + $0.01/request' }],
};

/** The composer under test. Labels come back as keys (global next-intl mock), so
 *  every assertion here is on DATA — model ids — not on translated copy. */
function renderComposer(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onModelSelectionChange = vi.fn();
  render(
    <ChatInput
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      modelSelection={{ mode: 'auto' }}
      modelOptions={options}
      onModelSelectionChange={onModelSelectionChange}
      {...props}
    />,
  );
  return { onModelSelectionChange };
}

/** The `/` control — the only place the composer offers model choice. */
const trigger = () => screen.getByRole('button', { name: /chatInput\.options/ });

describe('ChatInput `/` options menu', () => {
  it('accepts a batch of original files instead of making the user trim or convert them', async () => {
    const onAttach = vi.fn().mockResolvedValue(undefined);
    renderComposer({ onAttach });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.multiple).toBe(true);

    const files = [
      new File(['report'], 'report.pdf', { type: 'application/pdf' }),
      new File(['data'], 'data.csv', { type: 'text/csv' }),
    ];
    fireEvent.change(input!, { target: { files } });

    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledTimes(2));
    expect(onAttach).toHaveBeenNthCalledWith(1, files[0]);
    expect(onAttach).toHaveBeenNthCalledWith(2, files[1]);
  });

  it('is the only model affordance in the composer, and names the model in use on its trigger', () => {
    renderComposer({ modelSelection: { mode: 'model', model: 'plan/sonnet' } });

    expect(trigger()).toHaveTextContent('plan/sonnet');
    // No second "which model" chip beside it.
    expect(screen.getAllByRole('button', { name: /plan\/sonnet/ })).toHaveLength(1);
  });

  it('reports what auto actually resolved to rather than just "Auto"', () => {
    renderComposer({ modelSelection: { mode: 'auto' }, effectiveModel: 'free/qwen' });
    expect(trigger()).toHaveTextContent('free/qwen');
  });

  it('switches the model from the panel', () => {
    const { onModelSelectionChange } = renderComposer();

    fireEvent.click(trigger());
    const list = screen.getByRole('listbox');
    fireEvent.change(screen.getByRole('textbox', { name: /searchModels/ }), { target: { value: 'k2.5' } });
    fireEvent.click(within(list).getByText('direct/kimi-code/kimi-k2.5'));

    expect(onModelSelectionChange).toHaveBeenCalledWith({ mode: 'model', model: 'direct/kimi-code/kimi-k2.5' });
    // Choosing closes the menu — the composer goes back to being a composer.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by funding category', () => {
    renderComposer();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: /categoryByo/ }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('direct/kimi-code/kimi-k2.5')).toBeTruthy();
    expect(within(list).queryByText('free/qwen')).toBeNull();
  });

  it('says why instead of offering a dead list when the tenant may not pin a model', () => {
    renderComposer({ canChooseModel: false });

    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText(/chatInput\.modelLocked/)).toBeTruthy();
  });

  it('still carries run shaping — effort and thinking — alongside the model', () => {
    const onEffortChange = vi.fn();
    renderComposer({ effort: 'balanced', onEffortChange, thinking: false, onThinkingChange: vi.fn() });

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitemradio', { name: /effort_thorough/ }));
    expect(onEffortChange).toHaveBeenCalledWith('thorough');
    expect(screen.getByRole('menuitemcheckbox', { name: /chatInput\.thinking/ })).toBeTruthy();
  });
});
