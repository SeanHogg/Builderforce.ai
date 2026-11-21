import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComposerAttachment } from './AttachmentChips';

export type UploadGateNotice = 'waiting' | 'failed' | null;

export interface UploadGate {
  /** What the person is told under the chips: their send is waiting, or refused. */
  notice: UploadGateNotice;
  /**
   * Called by a send path BEFORE it sends: true ⇒ it must not send now. While a chip is
   * still uploading the send is HELD and fires itself (through `resend`) the moment the
   * last upload finishes; while a chip shows a failed upload it is refused — a message
   * never goes without a file the person attached.
   */
  intercept(resend: () => void): boolean;
}

/** The composer's guard between Send and its attachments' uploads (see {@link UploadGate.intercept}). */
export function useUploadGate(items: readonly ComposerAttachment[] | undefined): UploadGate {
  const uploading = !!items?.some((a) => a.status === 'uploading');
  const failed = !!items?.some((a) => a.status === 'error');
  const [held, setHeld] = useState<(() => void) | null>(null);
  const [refused, setRefused] = useState(false);
  const live = useRef({ uploading, failed });
  live.current = { uploading, failed };

  const intercept = useCallback((resend: () => void): boolean => {
    const { uploading: busy, failed: broken } = live.current;
    if (broken) { setHeld(null); setRefused(true); return true; }
    if (busy) { setHeld(() => resend); return true; }
    return false;
  }, []);

  // The held send goes once every upload has finished — unless one failed meanwhile.
  useEffect(() => {
    if (!held || uploading) return;
    setHeld(null);
    if (failed) setRefused(true);
    else held();
  }, [held, uploading, failed]);

  // The refusal note stands until the failed chip is gone (removed or attached again).
  useEffect(() => {
    if (refused && !failed) setRefused(false);
  }, [refused, failed]);

  const notice: UploadGateNotice = held ? 'waiting' : refused && failed ? 'failed' : null;
  return { notice, intercept };
}
