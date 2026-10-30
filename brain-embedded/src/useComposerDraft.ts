'use client';

import { useMemo, useRef, type Dispatch, type SetStateAction } from 'react';

/**
 * The composer's text as the SEND PATH sees it. A host clears the box as an offer starts and gives the words back
 * if the turn is not kept; "is the box empty?" must answer from what was just written, not from the last render -
 * a read that lags the clear would take the cleared words for a newer draft and not restore them. So every write
 * goes through here: the ref changes synchronously, before React's state does. ONE hook for the web panel, Rovr and
 * the editor chat; none keeps its own copy.
 *
 *  - `draft()` the text right now;
 *  - `setInput(text)` write it (clear, seed, give a turn back - `restoreTurn` reads `draft()` and writes the whole text).
 */
export function useComposerDraft(input: string, setInput: Dispatch<SetStateAction<string>>): {
  draft: () => string;
  setInput: (text: string) => void;
} {
  const ref = useRef(input);
  // The render's own value wins: it already includes every write made before it.
  // eslint-disable-next-line react-hooks/refs
  ref.current = input;
  return useMemo(() => ({
    draft: () => ref.current,
    setInput: (text: string) => {
      ref.current = text;
      setInput(text);
    },
  }), [setInput]);
}
