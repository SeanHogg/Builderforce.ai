'use client';

import { useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import type { ComposerDraftStore } from './composerDraftStore';

/** What the send path reads and writes of the composer's text. */
export interface ComposerDraft {
  draft: () => string;
  setInput: (next: SetStateAction<string>) => void;
}

/**
 * The composer's text as the SEND PATH sees it. A host clears the box as an offer starts and gives the words back
 * if the turn is not kept; "is the box empty?" must answer from what was just written, not from the last render -
 * a read that lags the clear would take the cleared words for a newer draft and not restore them. So every write
 * goes through here: the value changes synchronously, before React's state does. ONE hook for the web panel, Rovr and
 * the editor chat; none keeps its own copy.
 *
 *  - `draft()` the text right now;
 *  - `setInput(text)` write it (clear, seed), or `setInput(cur => next)` - an UPDATER, computed against what the box holds
 *    when the write lands (`restoreTurn` gives a turn back this way, so a concurrent clear or keystroke is respected).
 *
 * Two ways to hold the box:
 *  - a {@link ComposerDraftStore} (`useComposerDraftStore()`): the host never re-renders on a keystroke - the store IS the
 *    text and `draft`/`setInput` are its `get`/`set`, with an identity that never changes;
 *  - the legacy `(input, setInput)` pair: the ref follows the updater's result at once and the same updater goes to the
 *    state setter. For a host whose text is still React state.
 */
export function useComposerDraft(store: ComposerDraftStore): ComposerDraft;
export function useComposerDraft(input: string, setInput: Dispatch<SetStateAction<string>>): ComposerDraft;
export function useComposerDraft(source: ComposerDraftStore | string, setInput?: Dispatch<SetStateAction<string>>): ComposerDraft;
export function useComposerDraft(inputOrStore: string | ComposerDraftStore, setInput?: Dispatch<SetStateAction<string>>): ComposerDraft {
  const store = typeof inputOrStore === 'string' ? null : inputOrStore;
  const ref = useRef(typeof inputOrStore === 'string' ? inputOrStore : '');
  // The render's own value wins: it already includes every write made before it.
  if (typeof inputOrStore === 'string') {
    // eslint-disable-next-line react-hooks/refs
    ref.current = inputOrStore;
  }
  return useMemo(() => {
    if (store) return { draft: store.get, setInput: store.set };
    return {
      draft: () => ref.current,
      setInput: (next: SetStateAction<string>) => {
        ref.current = typeof next === 'function' ? next(ref.current) : next;
        setInput?.(next);
      },
    };
  }, [store, setInput]);
}
