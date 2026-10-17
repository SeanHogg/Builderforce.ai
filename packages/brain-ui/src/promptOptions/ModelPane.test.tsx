import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatModelSelection } from '@seanhogg/builderforce-brain-embedded';
import { PromptOptionsMenu } from './PromptOptionsMenu';
import { catalogRow, fakeLocalModelStore } from '../localModels/testStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(ui: ReactElement): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null | undefined) => act(() => { (el as HTMLElement).click(); });
const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((node) => node.textContent?.includes(text));

const READY = 'local/bfi/bonsai-1.7b-q1_0';
const ABSENT = 'local/bfi/bonsai-8b-q1_0';
const DOWNLOADING = 'local/webllm/Qwen3-4B-q4f16_1-MLC';
const UNSUPPORTED = 'local/webllm/Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

function storeWithEveryState() {
  return fakeLocalModelStore([
    catalogRow({ ref: READY, label: 'Bonsai 1.7B (1-bit)', state: 'ready', bytes: 248_302_272, contextTokens: 32_768 }),
    catalogRow({ ref: ABSENT, label: 'Bonsai 8B (1-bit)' }),
    catalogRow({ ref: DOWNLOADING, label: 'Qwen3 4B', runtime: 'webllm', tools: false, state: 'downloading', progress: 0.5 }),
    catalogRow({ ref: UNSUPPORTED, label: 'Hermes 3 Llama 3.1 8B', runtime: 'webllm', state: 'unsupported', reason: 'shader_f16_unavailable' }),
  ]);
}

async function openModelTab(
  onChange: (s: ChatModelSelection) => void,
  canChoose: boolean,
  identityPending = false,
  selection: ChatModelSelection = { mode: 'auto' },
) {
  const fake = storeWithEveryState();
  const el = mount(
    <PromptOptionsMenu
      model={{
        selection,
        options: { byo: [], free: ['meta/llama'], plan: [], paid: [] },
        onChange,
        identity: { product: canChoose ? 'pro' : 'free', canChoose },
        localStore: fake.store,
        identityPending,
      }}
    />,
  );
  click(el.querySelector('.bf-pmenu__trigger'));
  await flush();
  return { el, fake };
}

describe('<PromptOptionsMenu> Model tab — on-device models', () => {
  it('offers the on-device chip and renders every store state', async () => {
    const onChange = vi.fn();
    const { el } = await openModelTab(onChange, true);
    const chip = byText(el, '.bf-pmenu__filter', 'On this device');
    expect(chip).toBeTruthy();
    click(chip);
    await flush();

    const rows = [...el.querySelectorAll('.bf-lmodel')];
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['ready', 'absent', 'downloading', 'unsupported']);
    expect(byText(el, '.bf-lmodel__action', 'Download (1.2')).toBeTruthy();
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(byText(el, '.bf-lmodel__action', 'Cancel')).toBeTruthy();
    expect(byText(el, '.bf-lmodel__reason', '16-bit')).toBeTruthy();
    const unsupported = rows[3]!.querySelector('.bf-lmodel__main') as HTMLButtonElement;
    expect(unsupported.disabled).toBe(true);
    expect(byText(el, '.bf-lmodel__badge', 'Tools')).toBeTruthy();
  });

  it('pins a ready model through the SAME onChange a cloud model uses', async () => {
    const onChange = vi.fn();
    const { el } = await openModelTab(onChange, true);
    click(byText(el, '.bf-pmenu__filter', 'On this device'));
    await flush();
    click(el.querySelector('.bf-lmodel[data-state="ready"] .bf-lmodel__main'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'model', model: READY });
  });

  it('lists a downloaded model under All as an ordinary row', async () => {
    const { el } = await openModelTab(vi.fn(), true);
    expect(byText(el, '.bf-pmenu__option', 'Bonsai 1.7B (1-bit)')).toBeTruthy();
    expect(byText(el, '.bf-pmenu__option', 'Bonsai 8B (1-bit)')).toBeFalsy();
  });

  it('starts a download from the row and removes a ready model from its overflow', async () => {
    const { el, fake } = await openModelTab(vi.fn(), true);
    click(byText(el, '.bf-pmenu__filter', 'On this device'));
    await flush();
    click(byText(el, '.bf-lmodel__action', 'Download'));
    await flush();
    expect(el.querySelector(`.bf-lmodel[data-state="downloading"] .bf-lmodel__name`)?.textContent).toContain('Bonsai');
    act(() => fake.finish(ABSENT));
    await flush();

    click(el.querySelector('.bf-lmodel[data-state="ready"] .bf-lmodel__kebab'));
    click(byText(el, '.bf-lmodel__action', 'Remove'));
    await flush();
    expect(el.querySelectorAll('.bf-lmodel[data-state="ready"]').length).toBe(1);
  });

  it('still offers on-device models to a viewer who may not pin a catalog model', async () => {
    const onChange = vi.fn();
    const { el } = await openModelTab(onChange, false);
    expect(el.querySelector('.bf-pmenu__search')).toBeNull();
    click(el.querySelector('.bf-lmodel[data-state="ready"] .bf-lmodel__main'));
    expect(onChange).toHaveBeenCalledWith({ mode: 'model', model: READY });
  });

  it('offers a locked viewer the way back to Auto once an on-device model is pinned', async () => {
    const unpinned = await openModelTab(vi.fn(), false);
    expect(unpinned.el.querySelector('.bf-pmenu__option[aria-selected]')).toBeFalsy();
    cleanup?.();
    cleanup = undefined;

    const onChange = vi.fn();
    const { el } = await openModelTab(onChange, false, false, { mode: 'model', model: READY });
    const auto = [...el.querySelectorAll('.bf-pmenu__option')].find((node) => node.getAttribute('aria-selected') === 'false'
      && node.querySelector('.bf-pmenu__optTag')?.textContent === 'Auto');
    expect(auto).toBeTruthy();
    click(auto);
    expect(onChange).toHaveBeenCalledWith({ mode: 'auto' });
  });

  it('does not claim the plan forbids choosing while entitlement is still unknown', async () => {
    const locked = await openModelTab(vi.fn(), false);
    expect(locked.el.textContent).toContain('Model choice needs a paid plan');
    cleanup?.();
    cleanup = undefined;
    const pending = await openModelTab(vi.fn(), false, true);
    expect(pending.el.textContent).not.toContain('Model choice needs a paid plan');
    expect(pending.el.querySelectorAll('.bf-lmodel').length).toBe(4);
  });
});
