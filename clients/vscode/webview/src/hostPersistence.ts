import type { BrainPersistenceAdapter, InlinedAttachments } from '@seanhogg/builderforce-brain-embedded';
import type { LocalPersistenceMethod } from '../../src/bridgeProtocol';
import { request } from './bridgeTransport';
import { keepLocalThroughHost, newAttachmentUploadState, signThroughHost, uploadThroughHost, type AttachmentUploadPorts, type SavedAttachment } from './attachmentUpload';

/** `method` is the shared list the host dispatches on, so a name the host cannot
 *  serve does not compile here. */
const call = <T>(method: LocalPersistenceMethod, args: unknown[] = []): Promise<T> =>
  request<T>('local.persistence', { method, args });

export function createHostPersistence(): BrainPersistenceAdapter {
  // Attachments go through the host so they reach the model (`attachmentUpload.ts`):
  // a text is inlined into the turn, anything else uploaded with the extension's
  // credential. The `blob:` previews stay here, for the person's own view.
  const attachments = newAttachmentUploadState();
  const ports: AttachmentUploadPorts = {
    manifest: (meta) => call<SavedAttachment>('upload', [meta]),
    ingress: <T>(payload: Record<string, unknown>) => request<T>('attachment.ingress', payload),
    preview: (file) => URL.createObjectURL(file),
  };
  return {
    listChats: (params) => call('listChats', params === undefined ? [] : [params]),
    getChat: (id) => call('getChat', [id]),
    createChat: (body) => call('createChat', [body]),
    updateChat: (id, body) => call('updateChat', [id, body]),
    deleteChat: (id) => call('deleteChat', [id]),
    archiveChat: (id) => call('archiveChat', [id]),
    summarizeChat: (id) => call('summarizeChat', [id]),
    getMessages: (chatId, limit) => call('getMessages', limit === undefined ? [chatId] : [chatId, limit]),
    bindChat: (chatId) => call('bindChat', [chatId]),
    sendMessages: (chatId, messages) => call('sendMessages', [chatId, messages]),
    setMessageFeedback: (messageId, feedback, context) => call('setMessageFeedback', [messageId, feedback, context]),
    upload: (file) => uploadThroughHost(file, ports, attachments),
    // A picture the model receives inline stays on this machine (no cloud copy).
    keepLocal: (file) => keepLocalThroughHost(file, ports, attachments),
    // The platform URL when the file was uploaded (the link the model can follow), else
    // the local preview.
    uploadUrl: (key) => attachments.remote.get(key) ?? attachments.previews.get(key) ?? '',
    signedUploadUrl: (key) => signThroughHost(key, ports, attachments),
    inlineAttachments: (list) =>
      ports.ingress<InlinedAttachments | null>({ op: 'inline', attachments: list.map((a) => ({ key: a.key, name: a.name })) }),
  };
}
