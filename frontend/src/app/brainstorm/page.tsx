'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { brain, llmChat, type BrainChat, type BrainMessage } from '@/lib/builderforceApi';

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function BrainstormPage() {
  const [chatList, setChatList] = useState<BrainChat[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeChat, setActiveChat] = useState<BrainChat | null>(null);
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const msgEndRef = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const chats = await brain.listChats();
      setChatList(chats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chats');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  const selectChat = useCallback(async (chat: BrainChat) => {
    if (activeChat?.id === chat.id) return;
    setActiveChat(chat);
    setMessages([]);
    setLoadingMessages(true);
    setError('');
    try {
      const list = await brain.getMessages(chat.id);
      setMessages(list);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  }, [activeChat?.id]);

  const createNewChat = useCallback(async () => {
    try {
      const chat = await brain.createChat({ title: 'New chat' });
      setChatList((prev) => [chat, ...prev]);
      await selectChat(chat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create chat');
    }
  }, [selectChat]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    let chat = activeChat;
    if (!chat) {
      try {
        chat = await brain.createChat({ title: 'New chat' });
        setChatList((prev) => [chat!, ...prev]);
        setActiveChat(chat);
        setMessages([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create chat');
        setSending(false);
        return;
      }
    }
    setInput('');
    setSending(true);
    setError('');
    try {
      const [userMsg] = await brain.sendMessages(chat.id, [{ role: 'user', content: text }]);
      setMessages((prev) => [...prev, userMsg]);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      const history = [...messages, userMsg].slice(-80).map((m: BrainMessage) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
      const systemPrompt = 'You are Brain, the AI assistant inside Builderforce. Help the user brainstorm and plan. Be concise and use markdown when helpful.';
      const { content: reply } = await llmChat([
        { role: 'system', content: systemPrompt },
        ...history,
      ], { temperature: 0.3, maxTokens: 4096 });

      const [assistantMsg] = await brain.sendMessages(chat.id, [{ role: 'assistant', content: reply || 'No response.' }]);
      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [activeChat, input, sending, messages, createNewChat]);

  return (
    <div className="bs-shell" style={{ marginBottom: 0 }}>
      <div className="bs-sidebar">
        <div className="bs-sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>Brain Storm</span>
            <button
              type="button"
              onClick={createNewChat}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              + New
            </button>
          </div>
        </div>
        <div className="bs-chat-list">
          {loadingList && <div style={{ padding: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
          {!loadingList && chatList.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
              No chats yet. Click <strong>+ New</strong> to start.
            </div>
          )}
          {chatList.map((chat) => (
            <div
              key={chat.id}
              className={`bs-chat-item ${activeChat?.id === chat.id ? 'active' : ''}`}
              onClick={() => selectChat(chat)}
              onKeyDown={(e) => e.key === 'Enter' && selectChat(chat)}
              role="button"
              tabIndex={0}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {chat.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {formatTime(chat.updatedAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="bs-main">
        {error && (
          <div style={{ margin: '8px 12px 0', padding: '8px 12px', fontSize: 13, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>
            {error}
          </div>
        )}
        {!activeChat ? (
          <div className="bs-empty">
            <div style={{ fontSize: 40 }}>🧠</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Brain Storm</div>
            <div style={{ fontSize: 13 }}>Select a chat or start a new one to begin brainstorming.</div>
            <button
              type="button"
              onClick={createNewChat}
              style={{
                padding: '10px 18px',
                fontSize: 14,
                fontWeight: 600,
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              Start new chat
            </button>
          </div>
        ) : (
          <>
            <div className="bs-chat-header">
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>{activeChat.title}</span>
            </div>
            <div className="bs-messages">
              {loadingMessages && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading messages…</div>}
              {messages.map((msg) => (
                <div key={msg.id} className={`bs-msg ${msg.role === 'user' ? 'bs-msg-user' : ''}`}>
                  <div
                    className="bs-avatar"
                    style={{
                      background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: msg.role === 'user' ? '#fff' : 'var(--text)',
                    }}
                  >
                    {msg.role === 'user' ? 'U' : '🧠'}
                  </div>
                  <div className={`bs-bubble ${msg.role === 'user' ? 'bs-bubble-user' : 'bs-bubble-ai'}`}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="bs-msg">
                  <div className="bs-avatar" style={{ background: 'var(--bg-elevated)' }}>🧠</div>
                  <div className="bs-bubble bs-bubble-ai" style={{ color: 'var(--muted)' }}>Thinking…</div>
                </div>
              )}
              <div ref={msgEndRef} />
            </div>
            <div className="bs-input-area">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  style={{
                    flex: 1,
                    resize: 'none',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: 14,
                    minHeight: 42,
                    maxHeight: 120,
                    fontFamily: 'inherit',
                  }}
                  placeholder="Message Brain…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || !input.trim()}
                  style={{
                    height: 42,
                    padding: '0 16px',
                    fontSize: 14,
                    fontWeight: 600,
                    background: 'var(--accent)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                    opacity: sending || !input.trim() ? 0.7 : 1,
                  }}
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
