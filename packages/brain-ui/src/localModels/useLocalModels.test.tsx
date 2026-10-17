import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { LocalModelStore } from '@seanhogg/builderforce-brain-embedded';
import { useLocalModels, type LocalModelsState } from './useLocalModels';
import { catalogRow, fakeLocalModelStore } from './testStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BONSAI = 'local/bfi/bonsai-8b-q1_0';
const QWEN = 'local/webllm/Qwen3-4B-q4f16_1-MLC';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** Mount a probe component and expose the hook's latest state. */
function mountHook(store: LocalModelStore | undefined): { current: () => LocalModelsState } {
  let latest: LocalModelsState | undefined;
  function Probe() {
    latest = useLocalModels(store);
    return null;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root;
  act(() => {
    root = createRoot(el);
    root.render((<Probe />) as ReactElement);
  });
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return { current: () => latest! };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const stateOf = (hook: { current: () => LocalModelsState }, ref: string) => hook.current().rows?.find((row) => row.ref === ref);

describe('useLocalModels', () => {
  it('reads nothing without a store', async () => {
    const hook = mountHook(undefined);
    await flush();
    expect(hook.current().rows).toEqual([]);
  });

  it('walks a row absent → downloading (with progress) → ready', async () => {
    const fake = fakeLocalModelStore([catalogRow({ ref: BONSAI, label: 'Bonsai 8B (1-bit)' })]);
    const hook = mountHook(fake.store);
    expect(hook.current().rows).toBeNull();
    await flush();
    expect(stateOf(hook, BONSAI)?.state).toBe('absent');

    act(() => hook.current().download(BONSAI));
    await flush();
    expect(stateOf(hook, BONSAI)?.state).toBe('downloading');

    act(() => fake.progress(BONSAI, 0.42));
    await flush();
    expect(stateOf(hook, BONSAI)?.progress).toBe(0.42);

    act(() => fake.finish(BONSAI));
    await flush();
    expect(stateOf(hook, BONSAI)?.state).toBe('ready');
    expect(hook.current().failed.size).toBe(0);
  });

  it('cancel aborts the download without reporting a failure', async () => {
    const fake = fakeLocalModelStore([catalogRow({ ref: QWEN, label: 'Qwen3 4B', runtime: 'webllm' })]);
    const hook = mountHook(fake.store);
    await flush();
    act(() => hook.current().download(QWEN));
    await flush();
    act(() => hook.current().cancel(QWEN));
    await flush();
    expect(stateOf(hook, QWEN)?.state).toBe('absent');
    expect(hook.current().failed.has(QWEN)).toBe(false);
  });

  it('marks a failed download, and clears the mark on retry', async () => {
    const fake = fakeLocalModelStore([catalogRow({ ref: BONSAI, label: 'Bonsai 8B (1-bit)' })]);
    const hook = mountHook(fake.store);
    await flush();
    act(() => hook.current().download(BONSAI));
    await flush();
    act(() => fake.fail(BONSAI));
    await flush();
    expect(hook.current().failed.has(BONSAI)).toBe(true);

    act(() => hook.current().download(BONSAI));
    await flush();
    expect(hook.current().failed.has(BONSAI)).toBe(false);
    expect(stateOf(hook, BONSAI)?.state).toBe('downloading');
  });

  it('remove returns a ready row to absent', async () => {
    const fake = fakeLocalModelStore([catalogRow({ ref: BONSAI, label: 'Bonsai 8B (1-bit)', state: 'ready' })]);
    const hook = mountHook(fake.store);
    await flush();
    act(() => hook.current().remove(BONSAI));
    await flush();
    expect(stateOf(hook, BONSAI)?.state).toBe('absent');
  });
});
