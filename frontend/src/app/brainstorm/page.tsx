'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { brain, llmChat, type BrainChat, type BrainMessage } from '@/lib/builderforceApi';
import { fetchProjects, createProject } from '@/lib/api';
import type { Project } from '@/lib/types';
import { ChatInput, type ChatInputAttachment } from '@/components/ChatInput';
import { ChatMessageBubble } from '@/components/ChatMessageBubble';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { ThemeSelect } from '@/components/ThemeSelect';

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function BrainstormPage() {
  const searchParams = useSearchParams();
  const [chatList, setChatList] = useState<BrainChat[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeChat, setActiveChat] = useState<BrainChat | null>(null);
  const [messages, setMessages] = useState<BrainMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [assigningTo, setAssigningTo] = useState<number | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatInputAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'up' | 'down'>>({});
  const msgEndRef = useRef<HTMLDivElement>(null);
  const autoRepliedChatIdRef = useRef<number | null>(null);

  const loadChats = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const params = filterProjectId === 'none' ? { projectId: 'none' } : filterProjectId ? { projectId: filterProjectId } : undefined;
      const chats = await brain.listChats(params);
      setChatList(chats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chats');
    } finally {
      setLoadingList(false);
    }
  }, [filterProjectId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  const assignChatToProject = useCallback(async (chatId: number, projectId: number | null) => {
    setAssigningTo(chatId);
    setError('');
    try {
      const updated = await brain.updateChat(chatId, { projectId });
      setChatList((prev) => prev.map((c) => (c.id === chatId ? { ...c, projectId: updated.projectId } : c)));
      if (activeChat?.id === chatId) setActiveChat((c) => (c && c.id === chatId ? { ...c, projectId: updated.projectId } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign to project');
    } finally {
      setAssigningTo(null);
    }
  }, [activeChat?.id]);

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

  useEffect(() => {
    const map: Record<number, 'up' | 'down'> = {};
    messages.forEach((msg) => {
      if (msg.metadata) {
        try {
          const meta = JSON.parse(msg.metadata) as { feedback?: 'up' | 'down' };
          if (meta.feedback === 'up' || meta.feedback === 'down') map[msg.id] = meta.feedback;
        } catch { /* ignore */ }
      }
    });
    setFeedbackMap(map);
  }, [messages]);

  const copyMessage = useCallback(async (msg: BrainMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId((id) => (id === msg.id ? null : id)), 2000);
    } catch { /* ignore */ }
  }, []);

  const submitFeedback = useCallback(async (msg: BrainMessage, value: 'up' | 'down') => {
    const current = feedbackMap[msg.id];
    const newValue = current === value ? null : value;
    setFeedbackMap((prev) => {
      const next = { ...prev };
      if (newValue) next[msg.id] = newValue;
      else delete next[msg.id];
      return next;
    });
    try {
      await brain.setMessageFeedback(msg.id, newValue);
    } catch { /* best-effort */ }
  }, [feedbackMap]);

  const chatIdFromUrl = searchParams.get('chat');
  const projectIdFromUrl = searchParams.get('projectId');

  // When opening Brain with ?projectId=, pre-select that project so new chats are associated.
  useEffect(() => {
    if (projectIdFromUrl && projects.length > 0) {
      const id = projectIdFromUrl;
      if (projects.some((p) => String(p.id) === id)) {
        setFilterProjectId(id);
      }
    }
  }, [projectIdFromUrl, projects]);

  useEffect(() => {
    if (!chatIdFromUrl) return;
    const id = Number(chatIdFromUrl);
    if (Number.isNaN(id)) return;
    let chat = chatList.find((c) => c.id === id);
    if (chat && activeChat?.id !== chat.id) {
      selectChat(chat);
      return;
    }
    if (!loadingList && !chat && id) {
      brain.getChat(id).then((c) => {
        setChatList((prev) => {
          if (prev.some((x) => x.id === c.id)) return prev;
          return [c, ...prev];
        });
        selectChat(c);
      }).catch(() => {});
    }
  }, [chatIdFromUrl, loadingList, chatList, activeChat?.id, selectChat]);

  const createNewChat = useCallback(async () => {
    try {
      // Associate new chat with the project currently selected in the Project dropdown (if any).
      const projectId =
        filterProjectId && filterProjectId !== 'none'
          ? Number(filterProjectId)
          : null;
      const chat = await brain.createChat({ title: 'New chat', projectId });
      setChatList((prev) => [chat, ...prev]);
      await selectChat(chat);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create chat');
    }
  }, [selectChat, filterProjectId]);

  const handleAttach = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await brain.upload(file);
      setPendingAttachments((prev) => [...prev, { key: result.key, name: result.name, type: result.type }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  const createProjectAndAssign = useCallback(async () => {
    const name = newProjectName.trim();
    if (!name || !activeChat || creatingProject) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name });
      setProjects((prev) => [...prev, project]);
      await assignChatToProject(activeChat.id, project.id);
      setShowNewProject(false);
      setNewProjectName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      setCreatingProject(false);
    }
  }, [activeChat, newProjectName, creatingProject, assignChatToProject]);

  const filteredChatList = searchQuery.trim()
    ? chatList.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : chatList;

  const projectName = (id: number | null) => (id == null ? '' : (projects.find((p) => p.id === id)?.name ?? `#${id}`));

  const handleRename = useCallback(async () => {
    if (renamingId == null || !renameValue.trim()) {
      setRenamingId(null);
      setRenameValue('');
      return;
    }
    try {
      const updated = await brain.updateChat(renamingId, { title: renameValue.trim() });
      setChatList((prev) => prev.map((c) => (c.id === renamingId ? { ...c, title: updated.title } : c)));
      if (activeChat?.id === renamingId) setActiveChat((c) => (c && c.id === renamingId ? { ...c, title: updated.title } : c));
      setRenamingId(null);
      setRenameValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed');
    }
  }, [renamingId, renameValue, activeChat?.id]);

  const handleSummarize = useCallback(async (chatId: number) => {
    setSummarizingId(chatId);
    setError('');
    try {
      const result = await brain.summarizeChat(chatId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (result.summary) {
        const updated = await brain.updateChat(chatId, { title: result.summary });
        setChatList((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: updated.title } : c)));
        if (activeChat?.id === chatId) setActiveChat((c) => (c && c.id === chatId ? { ...c, title: updated.title } : c));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Summarize failed');
    } finally {
      setSummarizingId(null);
    }
  }, [activeChat?.id]);

  const handleDelete = useCallback(async (chat: BrainChat) => {
    const title = chat.title?.trim() || 'this chat';
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(chat.id);
    setError('');
    try {
      await brain.deleteChat(chat.id);
      setChatList((prev) => prev.filter((c) => c.id !== chat.id));
      if (activeChat?.id === chat.id) setActiveChat(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }, [activeChat?.id]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    let chat = activeChat;
    if (!chat) {
      try {
        const projectId = filterProjectId && filterProjectId !== 'none' ? Number(filterProjectId) : null;
        chat = await brain.createChat({ title: 'New chat', projectId });
        setChatList((prev) => [chat!, ...prev]);
        setActiveChat(chat);
        setMessages([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create chat');
        setSending(false);
        return;
      }
    }
    const attachments = [...pendingAttachments];
    setPendingAttachments([]);
    setInput('');
    setSending(true);
    setError('');
    let content = text;
    if (attachments.length > 0) {
      const refs = attachments.map((a) => `[Attached: ${a.name}](${brain.uploadUrl(a.key)})`).join('\n');
      content = `${text}\n\n${refs}`;
    }
    const metadata = attachments.length > 0 ? JSON.stringify({ attachments }) : undefined;
    try {
      const [userMsg] = await brain.sendMessages(chat.id, [{ role: 'user', content, metadata }]);
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
  }, [activeChat, input, sending, messages, createNewChat, filterProjectId, pendingAttachments]);

  const getAiReplyForCurrentMessages = useCallback(async () => {
    if (!activeChat || sending || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'user') return;
    setSending(true);
    setError('');
    try {
      const history = messages.slice(-80).map((m: BrainMessage) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));
      const systemPrompt = 'You are Brain, the AI assistant inside Builderforce. Help the user brainstorm and plan. Be concise and use markdown when helpful.';
      const { content: reply } = await llmChat(
        [{ role: 'system', content: systemPrompt }, ...history],
        { temperature: 0.3, maxTokens: 4096 }
      );
      const [assistantMsg] = await brain.sendMessages(activeChat.id, [{ role: 'assistant', content: reply || 'No response.' }]);
      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reply failed');
    } finally {
      setSending(false);
    }
  }, [activeChat, messages, sending]);

  useEffect(() => {
    if (!activeChat || loadingMessages || sending || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'user') return;
    if (autoRepliedChatIdRef.current === activeChat.id) return;
    autoRepliedChatIdRef.current = activeChat.id;
    getAiReplyForCurrentMessages();
  }, [activeChat?.id, loadingMessages, messages, sending, getAiReplyForCurrentMessages]);

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
          <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--muted)' }}>
            Project
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              New chats are added to the selected project.
            </span>
            <ThemeSelect
              ariaLabel="Filter by project"
              value={filterProjectId ?? ''}
              onChange={(v) => setFilterProjectId(v === '' ? null : v)}
              options={[
                { value: '', label: 'All' },
                { value: 'none', label: 'No project' },
                ...projects.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              style={{ marginTop: 4 }}
            />
          </label>
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
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
        </div>
        <div className="bs-chat-list">
          {loadingList && <div style={{ padding: 12, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>}
          {!loadingList && filteredChatList.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
              {chatList.length === 0 ? 'No chats yet. Click + New to start.' : 'No chats match your search.'}
            </div>
          )}
          {filteredChatList.map((chat) => (
            <div
              key={chat.id}
              className={`bs-chat-item ${activeChat?.id === chat.id ? 'active' : ''}`}
              onClick={() => selectChat(chat)}
              onKeyDown={(e) => e.key === 'Enter' && selectChat(chat)}
              role="button"
              tabIndex={0}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {renamingId === chat.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '100%', fontSize: 13, padding: 2, border: '1px solid var(--border)', borderRadius: 4 }}
                  />
                ) : (
                  chat.title
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {chat.projectId != null && (
                  <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 4, fontSize: 10 }}>
                    {projectName(chat.projectId)}
                  </span>
                )}
                {formatTime(chat.updatedAt)}
              </div>
              {activeChat?.id === chat.id && renamingId !== chat.id && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" onClick={() => { setRenamingId(chat.id); setRenameValue(chat.title); }} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>Rename</button>
                  <button type="button" onClick={() => handleSummarize(chat.id)} disabled={summarizingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{summarizingId === chat.id ? '…' : 'Summarize'}</button>
                  <button type="button" onClick={() => handleDelete(chat)} disabled={deletingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', color: 'var(--coral-bright)' }}>{deletingId === chat.id ? '…' : 'Delete'}</button>
                  {chat.projectId == null && (
                    <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Add to:
                      <ThemeSelect
                        ariaLabel="Add chat to project"
                        value=""
                        onChange={(val) => {
                          if (val === '__new__') setShowNewProject(true);
                          else if (val !== '') assignChatToProject(chat.id, Number(val));
                        }}
                        options={[
                          { value: '', label: 'Add to project…' },
                          { value: '__new__', label: '+ Create new project' },
                          ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                        ]}
                        style={{ marginLeft: 0, minWidth: 120, padding: '2px 6px', fontSize: 11 }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="bs-main">
        {error && (
          <div style={{ margin: '8px 12px 0', padding: '8px 12px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }}>
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
            <div className="bs-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>{activeChat.title}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {activeChat.projectId == null ? (
                  <>
                    <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      Assign to project:
                      <ThemeSelect
                        ariaLabel="Assign chat to project"
                        value=""
                        onChange={(val) => {
                          if (val === '__new__') setShowNewProject(true);
                          else if (val !== '') assignChatToProject(activeChat.id, Number(val));
                        }}
                        options={[
                          { value: '', label: 'No project' },
                          { value: '__new__', label: '+ Create new project' },
                          ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                        ]}
                        style={{ minWidth: 140, padding: '4px 8px', fontSize: 12 }}
                      />
                    </label>
                    {assigningTo === activeChat.id && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Assigning…</span>}
                    <button
                      type="button"
                      onClick={() => setShowNewProject(true)}
                      style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}
                    >
                      + Project
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{projectName(activeChat.projectId)}</span>
                    <Link
                      href={`/ide/${activeChat.projectId}?chat=${activeChat.id}`}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--coral-bright)',
                        textDecoration: 'none',
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--coral-bright)',
                      }}
                    >
                      Open in IDE →
                    </Link>
                  </>
                )}
              </div>
            </div>
            {showNewProject && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <input
                  placeholder="New project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProjectAndAssign()}
                  style={{ flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
                <button type="button" onClick={createProjectAndAssign} disabled={!newProjectName.trim() || creatingProject} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  {creatingProject ? '…' : 'Create & assign'}
                </button>
                <button type="button" onClick={() => { setShowNewProject(false); setNewProjectName(''); }} style={{ padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
            <div className="bs-messages">
              {loadingMessages && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading messages…</div>}
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  role={msg.role as 'user' | 'assistant'}
                  content={msg.content}
                  actions={
                    msg.role !== 'user' ? (
                      <ChatMessageActions
                        onCopy={() => copyMessage(msg)}
                        copied={copiedMessageId === msg.id}
                        feedback={feedbackMap[msg.id]}
                        onFeedback={(value) => submitFeedback(msg, value)}
                        projectId={activeChat.projectId ?? undefined}
                        assistantContent={msg.content}
                        conversationMessages={messages.map((m) => ({ role: m.role, content: m.content }))}
                        onPrdSaved={() => {}}
                        onTasksAdded={() => {}}
                      />
                    ) : undefined
                  }
                />
              ))}
              {sending && (
                <ChatMessageBubble role="assistant" content="" />
              )}
              <div ref={msgEndRef} />
            </div>
            <div className="bs-input-area">
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={send}
                placeholder="Message Brain…"
                disabled={sending}
                rows={2}
                submitOnEnter={false}
                onAttach={handleAttach}
                showBrainIcon={false}
                showVoice={true}
                pendingAttachments={pendingAttachments}
                onRemoveAttachment={(key) => setPendingAttachments((prev) => prev.filter((a) => a.key !== key))}
              />
              {uploading && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Uploading…</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
