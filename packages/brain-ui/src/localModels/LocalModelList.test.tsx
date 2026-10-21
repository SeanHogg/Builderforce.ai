import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LocalModelRow } from '@seanhogg/builderforce-brain-embedded';
import { DEFAULT_LOCAL_MODEL_LABELS } from './labels';
import { LocalModelList } from './LocalModelList';
import type { LocalModelsState } from './useLocalModels';
import { catalogRow } from './testStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The list every host renders: curated rows under a heading per use, the rest behind
 * "All models", unfit rows hidden — and one line saying why when nothing runs here.
 */

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(rows: LocalModelRow[], activeRef?: string): HTMLElement {
  const state: LocalModelsState = { rows, failed: new Set(), download: () => {}, cancel: () => {}, remove: () => {} };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => {
    root = createRoot(el);
    root.render(
      (
        <LocalModelList
          state={state}
          labels={DEFAULT_LOCAL_MODEL_LABELS}
          {...(activeRef ? { activeRef } : {})}
          onSelect={() => {}}
        />
      ) as ReactElement,
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
}

const names = (el: HTMLElement) => [...el.querySelectorAll('.bf-lmodel__name')].map((n) => n.firstChild?.textContent);
const headings = (el: HTMLElement) => [...el.querySelectorAll('.bf-lmodels__heading')].map((n) => n.textContent);

const bonsai = catalogRow({ ref: 'local/bfi/bonsai-8b-q1_0', label: 'Bonsai 8B' });
const coder = catalogRow({ ref: 'local/webllm/coder', label: 'Coder 3B', runtime: 'webllm', tools: false, uses: ['coding'] });
const extra = catalogRow({ ref: 'local/webllm/extra', label: 'Extra 1B', runtime: 'webllm', tools: false, recommended: false });
const embed = catalogRow({ ref: 'local/webllm/embed', label: 'Embedder', runtime: 'webllm', tools: false, uses: ['embedding'] });

describe('LocalModelList', () => {
  it('shows the curated rows by use and keeps the rest behind All models', () => {
    const el = mount([bonsai, coder, extra, embed]);
    expect(headings(el)).toEqual(['Agents & tools', 'Coding']);
    expect(names(el)).toEqual(['Bonsai 8B', 'Coder 3B']);
    const toggle = el.querySelector<HTMLButtonElement>('.bf-lmodels__toggle')!;
    expect(toggle.textContent).toBe('All models (1)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(names(el)).toEqual(['Bonsai 8B', 'Coder 3B', 'Extra 1B']);
    expect(toggle.textContent).toBe('Fewer models');
  });

  it('never buries a downloaded model behind All models', () => {
    const el = mount([bonsai, { ...extra, state: 'ready' }]);
    expect(names(el)).toEqual(['Bonsai 8B', 'Extra 1B']);
    expect(el.querySelector('.bf-lmodels__toggle')).toBeNull();
  });

  it('hides rows this device cannot run, and says why when none can', () => {
    const el = mount([
      { ...bonsai, state: 'unsupported', reason: 'webgpu_unavailable' },
      { ...coder, state: 'unsupported', reason: 'webgpu_unavailable' },
    ]);
    expect(names(el)).toEqual([]);
    expect(el.querySelector('.bf-lmodels__notice')?.textContent).toBe(DEFAULT_LOCAL_MODEL_LABELS.localReasonWebgpu);
  });

  it('lists the unfit rows behind All models, each with its reason', () => {
    const el = mount([bonsai, { ...coder, state: 'unsupported', reason: 'memory_insufficient' }]);
    expect(names(el)).toEqual(['Bonsai 8B']);
    const toggle = el.querySelector<HTMLButtonElement>('.bf-lmodels__toggle')!;
    expect(toggle.textContent).toBe('All models (1)');
    act(() => toggle.click());
    expect(names(el)).toEqual(['Bonsai 8B', 'Coder 3B']);
    expect(el.querySelector('.bf-lmodel__reason')?.textContent).toBe(DEFAULT_LOCAL_MODEL_LABELS.localReasonMemory);
  });

  it('keeps a downloaded model this device can no longer run listed, saying why, and removable', () => {
    const el = mount([{ ...bonsai, state: 'unsupported', reason: 'memory_insufficient', downloaded: true }]);
    expect(names(el)).toEqual(['Bonsai 8B']);
    expect(el.querySelector('.bf-lmodel__reason')?.textContent).toBe(DEFAULT_LOCAL_MODEL_LABELS.localReasonMemory);
    expect(el.querySelector('.bf-lmodel__kebab')).not.toBeNull();
  });
});
