import { useCallback, useMemo, useRef, useState } from 'react';
import type { AttachmentPreviewItem } from './types';

export interface AttachmentPreviewState {
  /** The attachment open in the preview, or null. */
  item: AttachmentPreviewItem | null;
  /** Open `item`; focus returns to `trigger` when the preview closes. */
  open(item: AttachmentPreviewItem, trigger?: HTMLElement | null): void;
  close(): void;
  /** Show `item` in place of the open one (it changed under the preview), keeping where focus returns. */
  replace(item: AttachmentPreviewItem): void;
}

/**
 * Which attachment is open in the preview, and where focus goes back to when it closes.
 * One per list of attachments (a turn's, the composer's) — the preview itself is
 * `AttachmentPreview`.
 */
export function useAttachmentPreview(): AttachmentPreviewState {
  const [item, setItem] = useState<AttachmentPreviewItem | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = useCallback((next: AttachmentPreviewItem, from?: HTMLElement | null) => {
    trigger.current = from ?? null;
    setItem(next);
  }, []);
  const close = useCallback(() => {
    setItem(null);
    const el = trigger.current;
    trigger.current = null;
    // The trigger may have gone (a chip removed meanwhile): focus only one still in the page.
    if (el && el.isConnected) el.focus();
  }, []);
  const replace = useCallback((next: AttachmentPreviewItem) => setItem(next), []);
  return useMemo(() => ({ item, open, close, replace }), [item, open, close, replace]);
}
