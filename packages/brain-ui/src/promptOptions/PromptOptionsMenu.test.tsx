import { describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { PromptOptionsMenu } from './PromptOptionsMenu';

function mount(ui: ReactElement): { el: HTMLDivElement; unmount: () => void } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return {
    el,
    unmount: () => {
      act(() => { root.unmount(); });
      el.remove();
    },
  };
}

const mode = {
  value: 'work',
  onChange: () => {},
  choices: [
    { value: 'chat', label: 'Chat', hint: 'Just answer' },
    { value: 'work', label: 'Work', hint: 'Turn it into tickets' },
  ],
};

describe('<PromptOptionsMenu> tabs', () => {
  it('opens onto Mode / Effort / Status tabs instead of a single scrolling list', () => {
    const { el, unmount } = mount(
      <PromptOptionsMenu
        mode={mode}
        effort="balanced"
        onEffortChange={() => {}}
        status={<div>plan details</div>}
      />,
    );
    const trigger = el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(el.querySelector('[role="tablist"]')).toBeNull();

    act(() => { trigger.click(); });

    const tablist = el.querySelector('[role="tablist"]');
    expect(tablist?.textContent).toContain('Mode');
    expect(tablist?.textContent).toContain('Effort');
    expect(tablist?.textContent).toContain('Status');
    expect(tablist?.textContent).not.toContain('Model');
    // Default pane is Mode — Chat/Work are visible, effort levels are not.
    expect(el.textContent).toContain('Chat');
    expect(el.textContent).toContain('Work');
    expect(el.textContent).not.toContain('Balanced');
    expect(el.textContent).not.toContain('plan details');
    unmount();
  });

  it('switches panes without closing, and hides Status when the host wires none', () => {
    const { el, unmount } = mount(
      <PromptOptionsMenu
        mode={mode}
        effort="balanced"
        onEffortChange={() => {}}
        thinking={false}
        onThinkingChange={() => {}}
      />,
    );
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    expect(el.querySelector('[role="tablist"]')?.textContent).not.toContain('Status');

    const effortTab = Array.from(el.querySelectorAll('[role="tab"]')).find((n) => n.textContent === 'Effort') as HTMLButtonElement;
    act(() => { effortTab.click(); });
    expect(el.textContent).toContain('Balanced');
    expect(el.textContent).toContain('Thinking');
    expect(el.textContent).not.toContain('Just answer');
    unmount();
  });
});
