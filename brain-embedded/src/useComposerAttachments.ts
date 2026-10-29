'use client';

import { useCallback, useState } from 'react';
import { prepareAttachment } from './attachmentContent';
import type { BrainPersistenceAdapter } from './config';
import type { ImagePrepOptions } from './imagePrep';
import type { ChatInputAttachment } from './types';

/**
 * The files the composer holds for the NEXT turn, split from `useBrainConversation` (which
 * only reads and writes them as a send starts and fails).
 *
 * Three moves, each one primitive, shared by every path that needs it:
 *  - {@link ComposerAttachments.take}: exactly a turn's OWN files leave the composer as its send
 *    starts - by key, so a file attached since (while a held turn waits) stays;
 *  - {@link ComposerAttachments.restore}: a send that was not kept puts back exactly those, merged
 *    by key - the web panel and the editor's chat both call it, so a failed send never loses a file;
 *  - {@link ComposerAttachments.remove}: the person took one out.
 */
export interface ComposerAttachments {
  pending: ChatInputAttachment[];
  uploading: boolean;
  attach(file: File): Promise<void>;
  remove(key: string): void;
  take(files: readonly Pick<ChatInputAttachment, 'key'>[]): void;
  restore(files: readonly ChatInputAttachment[]): void;
}

export function useComposerAttachments(
  persistence: Pick<BrainPersistenceAdapter, 'upload' | 'signedUploadUrl' | 'keepLocal'>,
  imagePrep: ImagePrepOptions | undefined,
  onError: (message: string) => void,
): ComposerAttachments {
  const [pending, setPending] = useState<ChatInputAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const attach = useCallback(async (file: File) => {
    setUploading(true);
    try {
      // Uploaded (a picture as its prepared copy), with a model-visible source for a
      // picture: an inline data URL when it fits, else a signed URL (`attachmentContent.ts`).
      const attachment = await prepareAttachment(file, persistence, imagePrep);
      setPending((prev) => [...prev, attachment]);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [persistence, imagePrep, onError]);

  const remove = useCallback((key: string) => {
    setPending((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const take = useCallback((files: readonly Pick<ChatInputAttachment, 'key'>[]) => {
    if (files.length === 0) return;
    const keys = new Set(files.map((a) => a.key));
    setPending((prev) => (prev.some((a) => keys.has(a.key)) ? prev.filter((a) => !keys.has(a.key)) : prev));
  }, []);

  const restore = useCallback((files: readonly ChatInputAttachment[]) => {
    if (files.length === 0) return;
    setPending((prev) => {
      const have = new Set(prev.map((a) => a.key));
      const back = files.filter((a) => !have.has(a.key));
      return back.length > 0 ? [...back, ...prev] : prev;
    });
  }, []);

  return { pending, uploading, attach, remove, take, restore };
}
