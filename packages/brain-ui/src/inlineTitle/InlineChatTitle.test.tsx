import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InlineChatTitle, type InlineChatTitleProps } from './InlineChatTitle';

/**
 * THE inline title all three surfaces edit in place: the rules that make it safe to
 * offer. Enter saves, Escape puts it back, a blank is never a title, and one edit
 * writes exactly once even though committing unmounts the field (whose blur then fires).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(ui: ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  act(() => { root.render(ui); });
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  const rerender = (next: ReactElement) => { act(() => { root.render(next); }); };
  return { el, rerender };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const press = (el: Element, k: string) =>
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

const button = (root: ParentNode) => root.querySelector('.bf-inline-title__button') as HTMLButtonElement | null;
const field = (root: ParentNode) => root.querySelector('.bf-inline-title__input') as HTMLInputElement | null;

function type(el: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function render(props: Partial<InlineChatTitleProps> = {}) {
  const onRename = vi.fn(async () => {});
  const ui = (p: Partial<InlineChatTitleProps>) => (
    <InlineChatTitle title="Plan" chatId={7} onRename={onRename} {...props} {...p} />
  );
  const { el, rerender } = mount(ui({}));
  return { el, rerender: (p: Partial<InlineChatTitleProps>) => rerender(ui(p)), onRename };
}

/** Click the title, then type `next` into the field it swapped to. */
function edit(el: HTMLElement, next: string): HTMLInputElement {
  act(() => { button(el)?.click(); });
  const input = field(el)!;
  type(input, next);
  return input;
}

describe('InlineChatTitle', () => {
  it('shows the title as a button, then swaps to a focused field with the text selected', () => {
    const { el } = render();
    expect(button(el)?.tagName).toBe('BUTTON');
    expect(button(el)?.textContent).toBe('Plan');
    expect(field(el)).toBeNull();

    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    act(() => { button(el)?.click(); });
    const input = field(el)!;
    expect(document.activeElement).toBe(input);
    // `select()` is what makes typing REPLACE the title rather than append to it.
    expect(select).toHaveBeenCalled();
    expect(input.value).toBe('Plan');
  });

  it('commits on Enter and shows the new title', async () => {
    const { el, onRename } = render();
    const input = edit(el, 'Roadmap');
    await act(async () => { press(input, 'Enter'); });
    await flush();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(7, 'Roadmap');
    expect(button(el)?.textContent).toBe('Roadmap');
  });

  it('trims the committed title', async () => {
    const { el, onRename } = render();
    const input = edit(el, '  Roadmap  ');
    await act(async () => { press(input, 'Enter'); });
    await flush();
    expect(onRename).toHaveBeenCalledWith(7, 'Roadmap');
  });

  it('reverts on Escape without calling onRename', async () => {
    const { el, onRename } = render();
    const input = edit(el, 'Roadmap');
    await act(async () => { press(input, 'Escape'); });
    await flush();
    expect(onRename).not.toHaveBeenCalled();
    expect(button(el)?.textContent).toBe('Plan');
  });

  it('never saves a blank or whitespace-only title', async () => {
    for (const blank of ['', '   ']) {
      const { el, onRename } = render();
      const input = edit(el, blank);
      await act(async () => { press(input, 'Enter'); });
      await flush();
      expect(onRename, `blank ${JSON.stringify(blank)} must not save`).not.toHaveBeenCalled();
      expect(button(el)?.textContent).toBe('Plan');
      cleanup?.();
      cleanup = undefined;
    }
  });

  it('reverts a blank blur instead of saving it', async () => {
    const { el, onRename } = render();
    const input = edit(el, '   ');
    await act(async () => { input.blur(); });
    await flush();
    expect(onRename).not.toHaveBeenCalled();
    expect(button(el)?.textContent).toBe('Plan');
  });

  it('commits a non-empty value on blur', async () => {
    const { el, onRename } = render();
    const input = edit(el, 'Roadmap');
    await act(async () => { input.blur(); });
    await flush();
    expect(onRename).toHaveBeenCalledWith(7, 'Roadmap');
  });

  it('does not double-commit when Enter unmounts the field and its blur fires', async () => {
    const { el, onRename } = render();
    const input = edit(el, 'Roadmap');
    await act(async () => { press(input, 'Enter'); });
    // The blur React fires as the input unmounts — the second commit this must swallow.
    await act(async () => { input.blur(); });
    await flush();
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('treats re-saving the unchanged title as no write', async () => {
    const { el, onRename } = render();
    const input = edit(el, 'Plan');
    await act(async () => { press(input, 'Enter'); });
    await flush();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('keeps an in-progress edit across a parent re-render', () => {
    const { el, rerender } = render();
    act(() => { button(el)?.click(); });
    type(field(el)!, 'Half typed');
    rerender({});
    expect(field(el)?.value).toBe('Half typed');
  });

  it('renders no editing affordance when there is no chat yet', () => {
    const { el } = mount(<InlineChatTitle title="New chat" chatId={null} onRename={vi.fn()} />);
    expect(button(el)).toBeNull();
    expect(field(el)).toBeNull();
    expect(el.textContent).toBe('New chat');
  });

  it('drops an open edit and the locally-shown title when the chat changes', async () => {
    const onRename = vi.fn(async () => {});
    function Host({ chatId }: { chatId: number | null }) {
      return <InlineChatTitle title={chatId === 7 ? 'Plan' : 'Other'} chatId={chatId} onRename={onRename} />;
    }
    const { el, rerender } = mount(<Host chatId={7} />);
    const input = edit(el, 'Renamed');
    await act(async () => { press(input, 'Enter'); });
    await flush();
    expect(button(el)?.textContent).toBe('Renamed');

    rerender(<Host chatId={9} />);
    expect(field(el)).toBeNull();
    expect(el.textContent).toContain('Other');
  });

  it('names the un-edited title for a screen reader, and the field while editing', () => {
    const { el } = render({ labels: { edit: 'Edit title', label: 'Chat title' } });
    expect(button(el)?.getAttribute('aria-label')).toBe('Edit title: Plan');
    act(() => { button(el)?.click(); });
    expect(field(el)?.getAttribute('aria-label')).toBe('Chat title');
  });

  it('is reachable by keyboard alone — a real button, then the focused field', () => {
    const { el } = render();
    const btn = button(el)!;
    expect(btn.getAttribute('type')).toBe('button');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // A real `<button>` turns Enter/Space into a click natively; that is what makes the
    // title openable without a pointer, and the field takes focus on its own.
    act(() => { btn.click(); });
    expect(document.activeElement).toBe(field(el));
  });
});