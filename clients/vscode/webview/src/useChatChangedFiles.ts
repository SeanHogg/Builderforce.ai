import { useEffect, useState } from 'react';
import type { AuthedFetch } from './authedFetch';
import type { ChatRef } from '../../src/chatRail/railProtocol';

/**
 * The files the active chat changed, for scoping the "Changes" pill — LOCAL-FIRST.
 *
 * The primary source is the host's LOCAL run-linked change-set records (G19), read over
 * the `local.chatRail` bridge: the chat's own runs recorded which repo-relative files they
 * changed at run end, so the pill answers with the platform denied and never shows a
 * stale, pre-sync count. This is the offline default.
 *
 * The server (`GET /api/brain/chats/:id/files`, the chat's synced `work_deltas`) is only
 * the backstop: consulted when the local store holds no record of this chat (a chat worked
 * on another device), to backfill what this machine has not seen. When neither source
 * settles, `null` keeps every change rather than hiding work we cannot attribute.
 *
 * `null` is also the "no chat" answer. `refreshKey` re-reads when the Brain records new
 * work mid-chat.
 */
export interface ChatChangedFilesReader {
  /** The chat's changed files from local change-set records, or null when unknown locally. */
  chatChangedFiles(chatId: ChatRef): Promise<string[] | null>;
}

export function useChatChangedFiles(
  apiReq: AuthedFetch,
  local: ChatChangedFilesReader,
  /** The chat as the rail names it: its SERVER id, else its local client id. */
  chatRef: ChatRef | null,
  /** Whether the chat is only local (no server id) — then the server can never answer. */
  isLocalOnly: boolean,
  refreshKey: number,
): string[] | null {
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    if (chatRef == null) {
      setFiles(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Local first: the chat's own runs recorded their changed files on this device.
      try {
        const localFiles = await local.chatChangedFiles(chatRef);
        if (localFiles != null) {
          if (!cancelled) setFiles(localFiles);
          return;
        }
      } catch { /* a failed local read falls through to the server backstop */ }
      // Backstop: a chat this device has not recorded (worked on elsewhere) — ask the server.
      if (isLocalOnly || typeof chatRef === 'string') return; // a local-only chat has no server files
      try {
        const res = await apiReq<{ files?: unknown }>(`/api/brain/chats/${chatRef}/files`);
        if (cancelled) return;
        setFiles(Array.isArray(res?.files) ? res.files.filter((f): f is string => typeof f === 'string') : []);
      } catch {
        if (!cancelled) setFiles(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiReq, local, chatRef, isLocalOnly, refreshKey]);
  return files;
}
