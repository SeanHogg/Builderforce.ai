'use client';

/**
 * Chat list + CRUD for the Brain. Persistence is injected via BrainProvider's
 * `persistence` adapter, so both the in-app Brain and external embeds share one
 * implementation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBrainConfig } from './config';
import type { BrainChat } from './types';

export interface UseBrainChatsOptions {
  /** Dropdown filter — id string, 'none', or null (all). Ignored when `pinnedProjectId` is set. */
  filterProjectId?: string | null;
  /** Project pages: lock the list (and new chats) to this project; no filter UI. */
  pinnedProjectId?: number | null;
  /**
   * Controlled active chat. When provided (not `undefined`), the active chat id
   * is owned by the caller instead of internal state — so two co-mounted Brain
   * instances (e.g. the IDE Designer left-panel and the floating drawer) can
   * share one selection via a common store. Pair with `onActiveChatChange`.
   */
  activeChatId?: number | null;
  /** Controlled-mode setter, called whenever the hook would change the selection. */
  onActiveChatChange?: (id: number | null) => void;
}

export interface UseBrainChats {
  chats: BrainChat[];
  loading: boolean;
  error: string;
  activeChatId: number | null;
  activeChat: BrainChat | null;
  setError(msg: string): void;
  select(id: number | null): Promise<BrainChat | null>;
  /** Create a chat (defaults project to the active filter/pin) and select it. */
  create(opts?: { title?: string; projectId?: number | null }): Promise<BrainChat | null>;
  rename(id: number, title: string): Promise<void>;
  summarize(id: number): Promise<void>;
  remove(id: number): Promise<void>;
  assignToProject(id: number, projectId: number | null): Promise<void>;
  reload(): Promise<void>;
  /** Bump a chat to the top + refresh ordering after new activity. */
  touch(id: number): Promise<void>;
}

export function useBrainChats(options: UseBrainChatsOptions = {}): UseBrainChats {
  const { persistence } = useBrainConfig();
  const { filterProjectId, pinnedProjectId, activeChatId: controlledActiveId, onActiveChatChange } = options;
  const [chats, setChats] = useState<BrainChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [internalActiveId, setInternalActiveId] = useState<number | null>(null);
  const assigningRef = useRef(false);

  // Controlled when the caller passes `activeChatId` (even null); otherwise the
  // hook owns the selection. Either way `setActiveChatId` is the single mutation
  // point so co-mounted instances can share one active chat via a common store.
  const isControlled = controlledActiveId !== undefined;
  const activeChatId = isControlled ? (controlledActiveId ?? null) : internalActiveId;
  // Keep the latest active id in a ref so callbacks can read it without being
  // re-created on every selection change (and without stale-closure bugs).
  const activeIdRef = useRef(activeChatId);
  activeIdRef.current = activeChatId;
  const setActiveChatId = useCallback(
    (id: number | null) => {
      if (isControlled) onActiveChatChange?.(id);
      else setInternalActiveId(id);
    },
    [isControlled, onActiveChatChange],
  );

  /** Resolve the projectId new chats should be associated with. */
  const defaultProjectId = useCallback((): number | null => {
    if (pinnedProjectId != null) return pinnedProjectId;
    return filterProjectId && filterProjectId !== 'none' ? Number(filterProjectId) : null;
  }, [pinnedProjectId, filterProjectId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params =
        pinnedProjectId != null
          ? { projectId: String(pinnedProjectId) }
          : filterProjectId === 'none'
            ? { projectId: 'none' }
            : filterProjectId
              ? { projectId: filterProjectId }
              : undefined;
      const list = await persistence.listChats(params);
      setChats(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  }, [persistence, filterProjectId, pinnedProjectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = useCallback(async (id: number | null): Promise<BrainChat | null> => {
    setError('');
    if (id === null) {
      setActiveChatId(null);
      return null;
    }
    setActiveChatId(id);
    // Pull the chat into the list if it isn't there (e.g. ?chat= deep links).
    const existing = chats.find((c) => c.id === id);
    if (existing) return existing;
    try {
      const chat = await persistence.getChat(id);
      setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : [chat, ...prev]));
      return chat;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open chat');
      return null;
    }
  }, [persistence, chats, setActiveChatId]);

  const create = useCallback(async (opts?: { title?: string; projectId?: number | null }): Promise<BrainChat | null> => {
    setError('');
    try {
      const projectId = opts?.projectId !== undefined ? opts.projectId : defaultProjectId();
      const chat = await persistence.createChat({ title: opts?.title ?? 'New chat', projectId });
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      return chat;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create chat');
      return null;
    }
  }, [persistence, defaultProjectId, setActiveChatId]);

  const rename = useCallback(async (id: number, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      const updated = await persistence.updateChat(id, { title: trimmed });
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }, [persistence]);

  const summarize = useCallback(async (id: number) => {
    setError('');
    try {
      const result = await persistence.summarizeChat(id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (result.summary) {
        const updated = await persistence.updateChat(id, { title: result.summary });
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: updated.title } : c)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Summarize failed');
    }
  }, [persistence]);

  const remove = useCallback(async (id: number) => {
    try {
      await persistence.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) setActiveChatId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }, [persistence, setActiveChatId]);

  const assignToProject = useCallback(async (id: number, projectId: number | null) => {
    if (assigningRef.current) return;
    assigningRef.current = true;
    setError('');
    try {
      const updated = await persistence.updateChat(id, { projectId });
      setChats((prev) => prev.map((c) => (c.id === id ? { ...c, projectId: updated.projectId } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign to project');
    } finally {
      assigningRef.current = false;
    }
  }, [persistence]);

  const touch = useCallback(async (id: number) => {
    // After new messages, refresh so updatedAt ordering + any title change reflect.
    await reload();
    setActiveChatId(id);
  }, [reload, setActiveChatId]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  return {
    chats,
    loading,
    error,
    activeChatId,
    activeChat,
    setError,
    select,
    create,
    rename,
    summarize,
    remove,
    assignToProject,
    reload,
    touch,
  };
}
