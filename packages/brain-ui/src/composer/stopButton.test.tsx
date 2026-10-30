import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerTrailingButton } from './ComposerTrailingButton';
import { DEFAULT_COMPOSER_LABELS } from './labels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Stop button hands its host NOTHING. A host's `onStop` may be a function whose first parameter means something
 * (the conversation's Stop takes the draft's token): passing the click event through (`onClick={onStop}`) made a
 * MouseEvent look like one.
 */
describe('the composer Stop button', () => {
  let root: Root | undefined;
  afterEach(() => { act(() => root?.unmount()); root = undefined; });

  it('calls onStop with no arguments', () => {
    const onStop = vi.fn();
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<ComposerTrailingButton labels={DEFAULT_COMPOSER_LABELS} canSubmit={false} running onSend={() => undefined} onStop={onStop} />));

    act(() => { host.querySelector<HTMLButtonElement>('.bf-cmp-iconbtn--stop')!.click(); });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0]).toEqual([]);
  });
});
