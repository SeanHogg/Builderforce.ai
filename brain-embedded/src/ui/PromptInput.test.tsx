import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptInput } from './PromptInput';

function setup(props: Partial<Parameters<typeof PromptInput>[0]> = {}) {
  const onSubmit = vi.fn();
  const onChange = vi.fn();
  render(<PromptInput value="hello" onChange={onChange} onSubmit={onSubmit} placeholder="Ask the agent" submitLabel="Send" {...props} />);
  return { onSubmit, onChange };
}

describe('PromptInput', () => {
  it('names the field and the arrow button with the host-translated words', () => {
    setup();
    expect(screen.getByRole('textbox', { name: 'Ask the agent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('sends on Enter and from the button', () => {
    const { onSubmit } = setup();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('does not send blank text, a disabled field, or a turn while one is in flight', () => {
    for (const props of [{ value: '   ' }, { disabled: true }, { busy: true }]) {
      const { onSubmit } = setup(props);
      fireEvent.keyDown(screen.getAllByRole('textbox').at(-1)!, { key: 'Enter' });
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it('keeps Shift+Enter for a newline, and leaves Enter alone when submitOnEnter is off', () => {
    const { onSubmit } = setup({ rows: 3, submitOnEnter: false });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reports every keystroke to the host', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello there' } });
    expect(onChange).toHaveBeenCalledWith('hello there');
  });

  it('draws the host\'s leading control and secondary content in place', () => {
    setup({ leading: <select aria-label="Agent" />, secondaryContent: <span>Why it is off</span> });
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByText('Why it is off')).toBeTruthy();
  });
});
