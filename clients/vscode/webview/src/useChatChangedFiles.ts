import { useEffect, useState } from 'react';
import type { AuthedFetch } from './authedFetch';

/**
 * The files the active chat changed (its work deltas), for scoping the "Changes" pill.
 * `null` while there is no chat or the list could not be loaded — an ambient read,
 * so a failure degrades to "show every change" instead of surfacing an error.
 * `refreshKey` re-reads it when the Brain records new work mid-chat.
 */
export function useChatChangedFiles(apiReq: AuthedFetch, chatId: number | null, refreshKey: number): string[] | null {
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    if (chatId == null) {
      setFiles(null);
      return;
    }
    let cancelled = false;
    apiReq<{ files?: unknown }>(`/api/brain/chats/${chatId}/files`)
      .then((res) => {
        if (!cancelled) setFiles(Array.isArray(res?.files) ? res.files.filter((f): f is string => typeof f === 'string') : []);
      })
      .catch(() => {
        if (!cancelled) setFiles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiReq, chatId, refreshKey]);
  return files;
}
