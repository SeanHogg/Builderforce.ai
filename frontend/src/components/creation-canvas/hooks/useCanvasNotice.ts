import { useCallback, useState } from 'react';
import { createCanvasNotices, type CanvasNotices } from '@/domains/canvas/application/PersistCanvas';

/**
 * The pill's one status line, arbitrated by the use case rather than by the canvas.
 *
 * `setNotice` is what the user did — shown until the next thing happens. `noteSaveState`
 * is the routine autosave tick; it has nothing of its own to say, so it clears the line
 * once a recent outcome's hold has expired rather than replacing it with ambient
 * "Saving…" chatter. The rule and the reason are in `application/PersistCanvas.ts` — what
 * matters here is that the two are DIFFERENT verbs, so a new message cannot pick the wrong
 * one by picking the only one.
 */
export function useCanvasNotice() {
  const [notice, setNoticeText] = useState('');
  const [notices] = useState<CanvasNotices>(() => createCanvasNotices(setNoticeText));
  const setNotice = useCallback((text: string) => notices.outcome(text), [notices]);
  const noteSaveState = useCallback(() => notices.saveState(''), [notices]);
  return { notice, setNotice, noteSaveState };
}
