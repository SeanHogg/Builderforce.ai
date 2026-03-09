'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AIChat } from './AIChat';
import {
  listProjectChats,
  getProjectChat,
  createProjectChat,
  appendProjectChatMessages,
  type ProjectChatSummary,
} from '@/lib/api';
import type { AIMessage } from '@/lib/types';

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface ProjectAIChatProps {
  projectId: number | string;
  /** Display name for the current project (IDE: project is fixed). */
  projectName?: string;
  activeFile?: string;
  activeFileContent?: string;
  onApplyCode?: (code: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  /** When provided, Up arrow starts a new Brain Storm session with the input and redirects (instead of sending to IDE AI). */
  onStartBrainStormSession?: (message: string) => void | Promise<void>;
  /** When opening IDE with a specific chat (e.g. /ide/1?chat=4), select this chat on load. */
  initialChatId?: number | null;
  /** Called when user selects a chat so the host can sync URL (e.g. /ide/1?chat=4). */
  onChatSelect?: (chatId: number | null) => void;
}

function toAIMessages(messages: Array<{ id: number; role: string; content: string }>): AIMessage[] {
  return messages.map(m => ({
    id: String(m.id),
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
}

export function ProjectAIChat({
  projectId,
  projectName,
  activeFile,
  activeFileContent,
  onApplyCode,
  onCreateFile,
  onStartBrainStormSession,
  initialChatId,
  onChatSelect,
}: ProjectAIChatProps) {
  const [chats, setChats] = useState<ProjectChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<number | null>(null);
  const [currentMessages, setCurrentMessages] = useState<AIMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatNotFoundError, setChatNotFoundError] = useState<string | null>(null);
  const initialChatIdAppliedRef = useRef(false);
  const lastChatAutoSelectRef = useRef(false);

  const loadChats = useCallback(async () => {
    try {
      const list = await listProjectChats(projectId);
      setChats(list);
    } catch (e) {
      console.error('Failed to load project chats:', e);
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const selectChat = useCallback(async (chatId: number | null) => {
    setChatNotFoundError(null);
    if (chatId === null) {
      setCurrentChatId(null);
      setCurrentMessages([]);
      onChatSelect?.(null);
      return;
    }
    setLoadingChat(true);
    try {
      const chat = await getProjectChat(projectId, chatId);
      setCurrentMessages(toAIMessages(chat.messages));
      setCurrentChatId(chatId);
      onChatSelect?.(chatId);
      setChats(prev => {
        if (prev.some(c => c.id === chat.id)) return prev;
        return [{ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt }, ...prev];
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        setChatNotFoundError(`Chat #${chatId} not found.`);
      }
      setCurrentChatId(null);
      setCurrentMessages([]);
    } finally {
      setLoadingChat(false);
    }
  }, [projectId, onChatSelect]);

  // When opening with ?chat=4: try to select that chat once list is ready; if not in list, fetch it (or show 404).
  useEffect(() => {
    if (loadingChats || initialChatId == null || initialChatIdAppliedRef.current) return;
    const inList = chats.some((c) => c.id === initialChatId);
    if (inList) {
      initialChatIdAppliedRef.current = true;
      selectChat(initialChatId);
      return;
    }
    initialChatIdAppliedRef.current = true;
    setLoadingChat(true);
    getProjectChat(projectId, initialChatId)
      .then((chat) => {
        setChats(prev => {
          if (prev.some(c => c.id === chat.id)) return prev;
          return [{ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt }, ...prev];
        });
        setCurrentMessages(toAIMessages(chat.messages));
        setCurrentChatId(chat.id);
        onChatSelect?.(chat.id);
      })
      .catch(() => {
        setChatNotFoundError(`Chat #${initialChatId} not found.`);
      })
      .finally(() => setLoadingChat(false));
  }, [loadingChats, chats, initialChatId, projectId, selectChat, onChatSelect]);

  useEffect(() => {
    lastChatAutoSelectRef.current = false;
  }, [projectId]);

  useEffect(() => {
    if (loadingChats || chats.length === 0 || currentChatId != null) return;
    if (initialChatId != null || lastChatAutoSelectRef.current) return;
    lastChatAutoSelectRef.current = true;
    const mostRecent = chats[0];
    if (mostRecent) selectChat(mostRecent.id);
  }, [loadingChats, chats, currentChatId, initialChatId, selectChat]);

  const createNewChat = useCallback(async () => {
    setChatNotFoundError(null);
    try {
      const created = await createProjectChat(projectId, 'New chat');
      setChats(prev => [created, ...prev]);
      setCurrentChatId(created.id);
      setCurrentMessages([]);
      onChatSelect?.(created.id);
    } catch (e) {
      console.error('Failed to create chat:', e);
    }
  }, [projectId, onChatSelect]);

  const handleMessagesPersisted = useCallback(
    async (user: { role: string; content: string }, assistant: { role: string; content: string }) => {
      try {
        let chatId = currentChatId;
        if (chatId === null) {
          const title = user.content.slice(0, 80).trim() || 'New chat';
          const created = await createProjectChat(projectId, title);
          chatId = created.id;
          setCurrentChatId(chatId);
          onChatSelect?.(chatId);
          await loadChats();
        }
        const updated = await appendProjectChatMessages(projectId, chatId, [user, assistant]);
        setCurrentMessages(toAIMessages(updated.messages));
        await loadChats();
      } catch (e) {
        console.error('Failed to persist chat messages:', e);
      }
    },
    [projectId, currentChatId, loadChats, onChatSelect]
  );

  const filteredChats = searchQuery.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : chats;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* Header: Brain + New; condensed chat history with collapsible panel */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Brain
          </span>
          <button
            type="button"
            onClick={createNewChat}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--accent, #3b82f6)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            + New
          </button>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          aria-label={historyOpen ? 'Collapse chat history' : 'Expand chat history'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '6px 8px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            cursor: 'pointer',
            marginBottom: historyOpen ? 8 : 0,
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>Chat history</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{historyOpen ? '▼' : '▶'}</span>
        </button>
        {historyOpen && (
          <input
            type="search"
            placeholder="Search chats…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)',
            }}
          />
        )}
      </div>

      {/* Chat list: only visible when history expanded */}
      {historyOpen && (
      <div style={{ flex: '0 1 35%', minHeight: 80, maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-subtle)' }}>
        {chatNotFoundError && (
          <div style={{ padding: 12, fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8, margin: 8 }}>
            {chatNotFoundError}
          </div>
        )}
        {loadingChats && (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
        )}
        {!loadingChats && filteredChats.length === 0 && (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            {chats.length === 0 ? 'No chats yet. Click + New to start.' : 'No chats match your search.'}
          </div>
        )}
        {filteredChats.map((chat) => (
          <div
            key={chat.id}
            role="button"
            tabIndex={0}
            onClick={() => selectChat(chat.id)}
            onKeyDown={(e) => e.key === 'Enter' && selectChat(chat.id)}
            style={{
              padding: '10px 12px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--border-subtle)',
              background: currentChatId === chat.id ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: currentChatId === chat.id ? '3px solid var(--coral-bright, #f43f5e)' : '3px solid transparent',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chat.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {formatTime(chat.updatedAt)}
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Conversation area */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-subtle)' }}>
        {loadingChat ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Loading…
          </div>
        ) : (
          <AIChat
            key={currentChatId ?? 'new'}
            projectId={projectId}
            activeFile={activeFile}
            activeFileContent={activeFileContent}
            onApplyCode={onApplyCode}
            onCreateFile={onCreateFile}
            initialMessages={currentMessages}
            onMessagesPersisted={handleMessagesPersisted}
            onStartBrainStormSession={onStartBrainStormSession}
          />
        )}
      </div>
    </div>
  );
}
