import type { BrainPersistenceAdapter } from '@seanhogg/builderforce-brain-embedded';
import { request } from './bridgeTransport';

const call = <T>(method: string, args: unknown[] = []): Promise<T> =>
  request<T>('local.persistence', { method, args });

export function createHostPersistence(): BrainPersistenceAdapter {
  const blobs = new Map<string, string>();
  return {
    listChats: (params) => call('listChats', params === undefined ? [] : [params]),
    getChat: (id) => call('getChat', [id]),
    createChat: (body) => call('createChat', [body]),
    updateChat: (id, body) => call('updateChat', [id, body]),
    deleteChat: (id) => call('deleteChat', [id]),
    archiveChat: (id) => call('archiveChat', [id]),
    summarizeChat: (id) => call('summarizeChat', [id]),
    getMessages: (chatId, limit) => call('getMessages', limit === undefined ? [chatId] : [chatId, limit]),
    sendMessages: (chatId, messages) => call('sendMessages', [chatId, messages]),
    setMessageFeedback: (messageId, feedback, context) => call('setMessageFeedback', [messageId, feedback, context]),
    upload: async (file) => {
      const saved = await call<{ key: string; name: string; type: string }>('upload', [{ name: file.name, type: file.type, size: file.size }]);
      blobs.set(saved.key, URL.createObjectURL(file));
      return saved;
    },
    uploadUrl: (key) => blobs.get(key) ?? '',
  };
}
