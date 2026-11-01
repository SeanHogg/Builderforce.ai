import { memo, Profiler, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import { BrainComposer } from './BrainComposer';
import { BrainTimeline } from '../BrainTimeline';

/**
 * WHAT RE-RENDERS WHEN, by count (the contract a surface relies on):
 *  - a keystroke re-renders the textarea and its typeahead - not the host, the transcript, the rail, the `/` menu or the `+` menu;
 *  - a streamed token re-renders the transcript's live row - not the (memoized) composer.
 * The real `PromptOptionsMenu` and `ComposerAddMenu` are wrapped only to count their renders.
 */
const counts = vi.hoisted(() => ({ options: 0, add: 0, timeline: 0, rail: 0, host: 0 }));

vi.mock('../promptOptions/PromptOptionsMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../promptOptions/PromptOptionsMenu')>();
  return { ...actual, PromptOptionsMenu: (props: Parameters<typeof actual.PromptOptionsMenu>[0]) => { counts.options += 1; return actual.PromptOptionsMenu(props); } };
});
vi.mock('./ComposerAddMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ComposerAddMenu')>();
  return { ...actual, ComposerAddMenu: (props: Parameters<typeof actual.ComposerAddMenu>[0]) => { counts.add += 1; return actual.ComposerAddMenu(props); } };
});

const noop = () => undefined;
const OPTIONS = {};
const NO_MESSAGES: never[] = [];

/** Stands in for the rail: memoized, props that never change. */
const Rail = memo(function Rail() { counts.rail += 1; return <div data-testid="rail" />; });

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function mount(node: ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  act(() => { root = createRoot(el!); root.render(node); });
  return el;
}
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0;
});

/** Type into the box the way a browser does: set the value, fire `input`. */
function type(textarea: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('typing in a composer on a draft store', () => {
  it('re-renders neither the host, the transcript, the rail nor the menus for 20 keystrokes', () => {
    const store = createComposerDraftStore();
    function Host() {
      counts.host += 1;
      return (
        <>
          <Profiler id="timeline" onRender={() => { counts.timeline += 1; }}>
            <BrainTimeline messages={NO_MESSAGES} trace={NO_MESSAGES} streamingText="" isRunning={false} />
          </Profiler>
          <Rail />
          <BrainComposer draftStore={store} onSubmit={noop} options={OPTIONS} />
        </>
      );
    }
    const root = mount(<Host />);
    const textarea = root.querySelector('textarea')!;
    const before = { ...counts };

    for (let i = 1; i <= 20; i += 1) type(textarea, 'x'.repeat(i));

    expect(store.get()).toBe('x'.repeat(20));
    expect(textarea.value).toBe('x'.repeat(20));
    expect(counts.host).toBe(before.host);
    expect(counts.timeline).toBe(before.timeline);
    expect(counts.rail).toBe(before.rail);
    // The frame re-renders when the box goes from empty to non-empty (Send turns on) - once, not per key.
    expect(counts.options - before.options).toBeLessThanOrEqual(1);
    expect(counts.add - before.add).toBeLessThanOrEqual(1);
  });

  it('a controlled value/onChange composer still works unchanged', () => {
    const changes: string[] = [];
    function Controlled() {
      const [value, setValue] = useState('');
      return <BrainComposer value={value} onChange={(v) => { changes.push(v); setValue(v); }} onSubmit={noop} options={OPTIONS} />;
    }
    const root = mount(<Controlled />);
    const textarea = root.querySelector('textarea')!;

    type(textarea, 'hello');

    expect(changes).toEqual(['hello']);
    expect(textarea.value).toBe('hello');
  });

  it('submits the store\'s text through onSubmit on Enter', () => {
    const store = createComposerDraftStore();
    const onSubmit = vi.fn();
    const root = mount(<BrainComposer draftStore={store} onSubmit={onSubmit} options={OPTIONS} />);
    const textarea = root.querySelector('textarea')!;
    type(textarea, 'go');

    act(() => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('a streamed token', () => {
  it('re-renders the transcript\'s live row, not the composer', () => {
    const store = createComposerDraftStore();
    let push!: (text: string) => void;
    function Host() {
      const [text, setText] = useState('');
      push = setText;
      return (
        <>
          <Profiler id="timeline" onRender={() => { counts.timeline += 1; }}>
            <BrainTimeline messages={NO_MESSAGES} trace={NO_MESSAGES} streamingText={text} isRunning />
          </Profiler>
          <BrainComposer draftStore={store} onSubmit={noop} options={OPTIONS} running />
        </>
      );
    }
    const root = mount(<Host />);
    const before = { ...counts };

    for (const text of ['A', 'A b', 'A bc', 'A bcd', 'A bcde']) act(() => push(text));

    expect(root.textContent).toContain('A bcde');
    expect(counts.timeline - before.timeline).toBeGreaterThanOrEqual(5);
    expect(counts.options).toBe(before.options);
    expect(counts.add).toBe(before.add);
  });
});

describe('a sent turn not yet saved', () => {
  it('shows as a trailing user row with no actions, and the empty state is gone', () => {
    const root = mount(<BrainTimeline messages={NO_MESSAGES} trace={NO_MESSAGES} streamingText="" isRunning pendingUserText="fix the build" />);

    const rows = root.querySelectorAll('.bf-tl__item--user');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('fix the build');
    expect(rows[0].querySelector('.bf-tl__actions')).toBeNull();
    expect(root.querySelector('.bf-tl-empty')).toBeNull();
    // The waiting row follows it: the same "Starting" indicator the transcript shows between turns.
    expect(root.querySelector('.bf-tl__item--live')).not.toBeNull();
  });

  it('names the model doing the work on the live row once its route is known', () => {
    const root = mount(<BrainTimeline messages={NO_MESSAGES} trace={NO_MESSAGES} streamingText="" isRunning liveModel="local/kimi-code/k3" liveAccount="own" />);

    const model = root.querySelector('.bf-tl__live-model');
    expect(model?.textContent).toBe('k3');
    expect(model?.getAttribute('title')).toBe('local/kimi-code/k3');
  });

  it('shows no model before the route is known', () => {
    const root = mount(<BrainTimeline messages={NO_MESSAGES} trace={NO_MESSAGES} streamingText="" isRunning />);
    expect(root.querySelector('.bf-tl__live-model')).toBeNull();
  });
});
