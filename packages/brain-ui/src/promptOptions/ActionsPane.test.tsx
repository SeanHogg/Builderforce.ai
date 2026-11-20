import { describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactElement } from 'react';
import { createComposerCommandRegistry } from '@seanhogg/builderforce-brain-embedded';
import { PromptOptionsMenu } from './PromptOptionsMenu';
import { ActionsPane } from './ActionsPane';
import { DEFAULT_PROMPT_OPTIONS_LABELS } from './types';

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

const registry = createComposerCommandRegistry(
  [
    {
      id: 'starter-kit',
      syntax: '/starter-kit <kit> [--with <extra,...>]',
      args: [{ name: 'kit', required: true, choices: [{ value: 'react-node' }] }],
      example: '/starter-kit react-node --with postgres',
    },
    {
      id: 'launch',
      syntax: '/launch [environment]',
      args: [],
      example: '/launch',
      availability: { ok: false, reason: 'Only in the VS Code extension' },
    },
  ],
  { describe: (id) => `About ${id}` },
);

const tabNamed = (el: HTMLElement, name: string) =>
  Array.from(el.querySelectorAll('[role="tab"]')).find((node) => node.textContent === name) as HTMLButtonElement | undefined;

describe('<PromptOptionsMenu> Actions tab', () => {
  it('shows no Actions tab unless the host passes commands', () => {
    const { el, unmount } = mount(<PromptOptionsMenu effort="balanced" onEffortChange={() => {}} />);
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    expect(tabNamed(el, 'Actions')).toBeUndefined();
    unmount();
  });

  it('renders every registry entry and reports the chosen id', () => {
    const onChoose = vi.fn();
    const { el, unmount } = mount(<PromptOptionsMenu commands={{ help: registry.help(), onChoose }} />);
    act(() => { (el.querySelector('.bf-pmenu__trigger') as HTMLButtonElement).click(); });
    expect(tabNamed(el, 'Actions')).toBeTruthy();
    expect(el.textContent).toContain('/help [command]');
    expect(el.textContent).toContain('/starter-kit <kit> [--with <extra,...>]');
    expect(el.textContent).toContain('About starter-kit');
    expect(el.textContent).toContain('/starter-kit react-node --with postgres');

    const kit = Array.from(el.querySelectorAll('.bf-pmenu__item')).find((node) => node.textContent?.includes('/starter-kit <kit>')) as HTMLButtonElement;
    act(() => { kit.click(); });
    expect(onChoose).toHaveBeenCalledWith('starter-kit');
    // Choosing closes the menu.
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    unmount();
  });

  it('shows an unavailable entry disabled with its reason, never hidden', () => {
    const onChoose = vi.fn();
    const { el, unmount } = mount(<ActionsPane commands={{ help: registry.help(), onChoose }} labels={DEFAULT_PROMPT_OPTIONS_LABELS} />);
    const launch = Array.from(el.querySelectorAll('.bf-pmenu__item')).find((node) => node.textContent?.includes('/launch')) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(launch.textContent).toContain('Only in the VS Code extension');
    expect(launch.textContent).toContain('Unavailable');
    act(() => { launch.click(); });
    expect(onChoose).not.toHaveBeenCalled();
    unmount();
  });

  it('answers an unknown command with "no such command" and the full list', () => {
    const { el, unmount } = mount(
      <ActionsPane commands={{ help: registry.helpForUnknown('deploy'), onChoose: () => {} }} labels={DEFAULT_PROMPT_OPTIONS_LABELS} />,
    );
    expect(el.querySelector('[role="status"]')?.textContent).toBe('No such command: /deploy');
    expect(el.querySelectorAll('.bf-pmenu__item')).toHaveLength(3);
    unmount();
  });

  it('states when no command is registered', () => {
    const { el, unmount } = mount(<ActionsPane commands={{ help: { entries: [] }, onChoose: () => {} }} labels={DEFAULT_PROMPT_OPTIONS_LABELS} />);
    expect(el.textContent).toContain('No commands are available here');
    unmount();
  });
});
