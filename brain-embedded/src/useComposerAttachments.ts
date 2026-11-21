'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prepareAttachment } from './attachmentContent';
import type { BrainPersistenceAdapter } from './config';
import type { ImagePrepOptions } from './imagePrep';
import type { ChatInputAttachment } from './types';

/**
 * One chip of the composer, as the person sees it (brain-ui's `ComposerAttachment` shape):
 * shown the moment a file is attached, from the file on this device, while it uploads.
 */
export interface ComposerAttachmentChip {
  key: string;
  name: string;
  type?: string;
  size?: number;
  /** A thumbnail for a picture. */
  imageUrl?: string;
  /** The ORIGINAL file on this device (an object URL) — the preview's picture and download. */
  localUrl?: string;
  /** Still uploading, or the upload failed (`error` is the reason). Absent ⇒ ready to send. */
  status?: 'uploading' | 'error';
  error?: string;
}

/**
 * The files the composer holds for the NEXT turn, split from `useBrainConversation` (which
 * only reads and writes them as a send starts and fails).
 *
 * Attaching never waits: the chip appears at once (a local object URL as its thumbnail), the
 * upload runs behind it, and the chip becomes the uploaded attachment — or an error chip with
 * the host's reason (a refusal: signed out, Local only, too large). Only an uploaded one is in
 * {@link ComposerAttachments.pending}, the list a send takes; `uploading` says one is still
 * on its way, so the composer holds a send until it lands.
 *
 * Three moves, each one primitive, shared by every path that needs it:
 *  - {@link ComposerAttachments.take}: exactly a turn's OWN files leave the composer as its send
 *    starts - by key, so a file attached since (while a held turn waits) stays;
 *  - {@link ComposerAttachments.restore}: a send that was not kept puts back exactly those, merged
 *    by key - the web panel and the editor's chat both call it, so a failed send never loses a file;
 *  - {@link ComposerAttachments.remove}: the person took one out (an uploading or failed chip too).
 */
export interface ComposerAttachments {
  pending: ChatInputAttachment[];
  /** Every chip to show: the uploaded ones, then those still uploading or failed. */
  chips: ComposerAttachmentChip[];
  uploading: boolean;
  attach(file: File): Promise<void>;
  remove(key: string): void;
  take(files: readonly Pick<ChatInputAttachment, 'key'>[]): void;
  restore(files: readonly ChatInputAttachment[]): void;
}

/** A chip not uploaded (yet): on its way, or failed. */
interface Staged {
  key: string;
  name: string;
  type: string;
  size: number;
  status: 'uploading' | 'error';
  error?: string;
}

/** The file on this device behind a chip. */
interface Local {
  url?: string;
  type: string;
  size: number;
}

function objectUrlOf(file: Blob): string | undefined {
  try {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
  } catch {
    return undefined;
  }
}

function revoke(url: string | undefined): void {
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch { /* already gone */ }
}

const isImage = (type: string | undefined) => !!type?.startsWith('image/');

let stagedSeq = 0;

export function useComposerAttachments(
  persistence: Pick<BrainPersistenceAdapter, 'upload' | 'signedUploadUrl' | 'keepLocal'>,
  imagePrep: ImagePrepOptions | undefined,
): ComposerAttachments {
  const [pending, setPending] = useState<ChatInputAttachment[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  // key → the file on this device. A ref, revoked outside any state updater.
  const locals = useRef(new Map<string, Local>());
  // Staged keys the person removed while their upload ran: its result is dropped.
  const dropped = useRef(new Set<string>());

  const forgetLocal = useCallback((key: string) => {
    revoke(locals.current.get(key)?.url);
    locals.current.delete(key);
  }, []);

  // An upload that lands after unmount must not keep (or re-register) an object URL.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const l of locals.current.values()) revoke(l.url);
      locals.current.clear();
    };
  }, []);

  const attach = useCallback(async (file: File) => {
    stagedSeq += 1;
    const key = `staged-${Date.now().toString(36)}-${stagedSeq}`;
    locals.current.set(key, { url: objectUrlOf(file), type: file.type, size: file.size });
    setStaged((prev) => [...prev, { key, name: file.name, type: file.type, size: file.size, status: 'uploading' }]);
    try {
      // Uploaded (a picture as its prepared copy), with a model-visible source for a
      // picture: an inline data URL when it fits, else a signed URL (`attachmentContent.ts`).
      const attachment = await prepareAttachment(file, persistence, imagePrep);
      if (dropped.current.delete(key)) return;
      const local = locals.current.get(key);
      locals.current.delete(key);
      if (!mounted.current) { revoke(local?.url); return; }
      if (local) locals.current.set(attachment.key, local);
      setStaged((prev) => prev.filter((s) => s.key !== key));
      setPending((prev) => [...prev, attachment]);
    } catch (e) {
      if (dropped.current.delete(key)) return;
      if (!mounted.current) { forgetLocal(key); return; }
      // The chip carries the reason (the host's sentence, e.g. a Local-only refusal).
      const error = e instanceof Error && e.message ? e.message : '';
      setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, status: 'error', error } : s)));
    }
  }, [persistence, imagePrep, forgetLocal]);

  const remove = useCallback((key: string) => {
    forgetLocal(key);
    setStaged((prev) => {
      const hit = prev.find((s) => s.key === key);
      if (!hit) return prev;
      if (hit.status === 'uploading') dropped.current.add(key);
      return prev.filter((s) => s.key !== key);
    });
    setPending((prev) => prev.filter((a) => a.key !== key));
  }, [forgetLocal]);

  const take = useCallback((files: readonly Pick<ChatInputAttachment, 'key'>[]) => {
    if (files.length === 0) return;
    const keys = new Set(files.map((a) => a.key));
    // The turn carries its own copy now; the device-side originals are let go.
    for (const k of keys) forgetLocal(k);
    setPending((prev) => (prev.some((a) => keys.has(a.key)) ? prev.filter((a) => !keys.has(a.key)) : prev));
  }, [forgetLocal]);

  const restore = useCallback((files: readonly ChatInputAttachment[]) => {
    if (files.length === 0) return;
    setPending((prev) => {
      const have = new Set(prev.map((a) => a.key));
      const back = files.filter((a) => !have.has(a.key));
      return back.length > 0 ? [...back, ...prev] : prev;
    });
  }, []);

  const chips = useMemo<ComposerAttachmentChip[]>(() => [
    ...pending.map((a) => {
      const local = locals.current.get(a.key);
      const type = a.type || local?.type;
      return {
        key: a.key,
        name: a.name,
        ...(type ? { type } : {}),
        ...(local ? { size: local.size } : {}),
        ...(a.imageUrl || (local?.url && isImage(type)) ? { imageUrl: local?.url && isImage(type) ? local.url : a.imageUrl } : {}),
        ...(local?.url ? { localUrl: local.url } : {}),
      };
    }),
    ...staged.map((s) => {
      const url = locals.current.get(s.key)?.url;
      return {
        key: s.key,
        name: s.name,
        ...(s.type ? { type: s.type } : {}),
        size: s.size,
        ...(url && isImage(s.type) ? { imageUrl: url } : {}),
        ...(url ? { localUrl: url } : {}),
        status: s.status,
        ...(s.error ? { error: s.error } : {}),
      };
    }),
  ], [pending, staged]);

  const uploading = staged.some((s) => s.status === 'uploading');
  return { pending, chips, uploading, attach, remove, take, restore };
}
