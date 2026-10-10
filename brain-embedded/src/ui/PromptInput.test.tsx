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

  it('turns the trailing button into Stop while a turn streams with an empty field', () => {
    const onStop = vi.fn();
    const { onSubmit } = setup({ value: '', busy: true, onStop, stopLabel: 'Stop' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps Send while busy when there is text, or when the host gave no Stop wording', () => {
    setup({ busy: true, onStop: vi.fn(), stopLabel: 'Stop' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    setup({ value: '', busy: true, onStop: vi.fn() });
    expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(2);
  });

  it('draws the host\'s leading control and secondary content in place', () => {
    setup({ leading: <select aria-label="Agent" />, secondaryContent: <span>Why it is off</span> });
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByText('Why it is off')).toBeTruthy();
  });
});
