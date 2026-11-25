/**
 * The editor's download port for brain-ui's attachment preview (`AttachmentDownload`). A
 * webview has no downloads and no credential, so the HOST saves the original
 * (`attachment.download` → `../../../src/attachmentDownload.ts`): an account or `data:` URL
 * is handed over as it is; a `blob:` URL (a file attached on this device) only lives in
 * this webview, so its bytes are read here and sent along — refused HERE when over the
 * one shared ceiling, before a byte is encoded or crosses `postMessage` (an oversized
 * message has taken the extension host down before).
 */
import { useMemo } from 'react';
import type { AttachmentDownload, AttachmentPreviewItem } from '@seanhogg/builderforce-brain-ui';
import { ATTACHMENT_DOWNLOAD_MAX_BYTES } from '../../../src/attachments/attachmentLimits';
import { base64Of } from '../attachmentUpload';
import { request } from '../bridgeTransport';
import type { LabelBundle } from '../vscodeBridge';

type HostRequest = <T>(type: 'attachment.download', payload: Record<string, unknown>) => Promise<T>;

export interface HostAttachmentDownloadOptions {
  /** The person's sentence for a file over the ceiling. */
  tooLarge: (name: string) => string;
  send?: HostRequest;
  readBlob?: (url: string) => Promise<Blob>;
}

export function createHostAttachmentDownload({
  tooLarge,
  send = (type, payload) => request(type, payload),
  readBlob = async (url) => (await fetch(url)).blob(),
}: HostAttachmentDownloadOptions): AttachmentDownload {
  return async (item: AttachmentPreviewItem) => {
    const url = item.downloadUrl;
    if (!url) throw new Error('');
    const payload: Record<string, unknown> = { name: item.name, ...(item.type ? { mime: item.type } : {}) };
    if (url.startsWith('blob:')) {
      // The size we were told, then the blob's own — both before any encoding.
      if ((item.size ?? 0) > ATTACHMENT_DOWNLOAD_MAX_BYTES) throw new Error(tooLarge(item.name));
      const blob = await readBlob(url);
      if (blob.size > ATTACHMENT_DOWNLOAD_MAX_BYTES) throw new Error(tooLarge(item.name));
      payload.data = await base64Of(blob);
    } else {
      payload.url = url;
    }
    const answer = await send<{ saved?: boolean } | undefined>('attachment.download', payload);
    return answer?.saved !== false;
  };
}

/** The panel's download port, worded from the host bundle (stable while the bundle is). */
export function useHostAttachmentDownload(labels: LabelBundle): AttachmentDownload {
  return useMemo(() => {
    const template = labels['att.tooLarge'] ?? '{name} is too large to download here: the limit is {limit} MB.';
    const limit = String(Math.round(ATTACHMENT_DOWNLOAD_MAX_BYTES / (1024 * 1024)));
    return createHostAttachmentDownload({ tooLarge: (name) => template.replace('{name}', name).replace('{limit}', limit) });
  }, [labels]);
}
