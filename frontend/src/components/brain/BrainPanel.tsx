'use client';

/**
 * The one Brain UI. Used by BOTH the full-page Brain Storm route
 * (`variant="page"`) and the global docked drawer (`variant="docked"`). All
 * logic comes from the shared hooks (`useBrainChats` / `useBrainConversation`)
 * and the page-action registry — the only thing that differs between variants
 * is chrome (two-column page vs. collapsible drawer).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChatInput } from '@/components/ChatInput';
import { ChatMessageBubble } from '@/components/ChatMessageBubble';
import { ChatMessageActions } from '@/components/ChatMessageActions';
import { ThemeSelect } from '@/components/ThemeSelect';
import { fetchProjects, createProject } from '@/lib/api';
import type { Project } from '@/lib/types';
import { type ProjectModality } from '@/lib/modality';
import {
  useBrainChats,
  useBrainConversation,
  useBrainActions,
} from '@/lib/brain';
import type { BrainChat, BrainMessage } from '@/lib/builderforceApi';

const BRAINSTORM_SYSTEM_PROMPT =
  'You are Brain, the AI assistant inside Builderforce. Help the user brainstorm and plan. Be concise and use markdown when helpful.';

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export interface BrainPanelProps {
  variant: 'page' | 'docked';
  /** Lock the Brain to one project (docked-in-IDE / project pages). */
  pinnedProjectId?: number | null;
  /** Active modality — drives the docked Brain's persona. */
  modality?: ProjectModality;
  /** Extra system-prompt context (e.g. the IDE's open file). */
  extraSystem?: string;
  /** Deep-link: select this chat on mount. */
  initialChatId?: number | null;
  /** Brain Storm: pre-select a project filter (from ?projectId=). */
  initialFilterProjectId?: string | null;
  /** Docked only: close handler for the drawer chrome. */
  onClose?: () => void;
}

export function BrainPanel({
  variant,
  pinnedProjectId = null,
  modality = 'designer',
  extraSystem,
  initialChatId,
  initialFilterProjectId,
  onClose,
}: BrainPanelProps) {
  const isPage = variant === 'page';
  const [filterProjectId, setFilterProjectId] = useState<string | null>(initialFilterProjectId ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [summarizingId, setSummarizingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  const { toolSpecs, runTool } = useBrainActions();

  const chats = useBrainChats(
    pinnedProjectId != null ? { pinnedProjectId } : { filterProjectId },
  );

  const ensureChatId = useCallback(async () => {
    const c = await chats.create();
    return c?.id ?? null;
  }, [chats]);

  const conv = useBrainConversation({
    chatId: chats.activeChatId,
    modality,
    extraSystem,
    systemPrompt: isPage ? BRAINSTORM_SYSTEM_PROMPT : undefined,
    toolSpecs,
    runTool,
    ensureChatId,
    onActivity: chats.touch,
  });

  // Projects for the filter/assignment dropdowns.
  useEffect(() => {
    fetchProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  // Apply ?chat= deep link once chats are available.
  useEffect(() => {
    if (initialChatId == null || chats.loading) return;
    if (chats.activeChatId === initialChatId) return;
    chats.select(initialChatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChatId, chats.loading]);

  const projectName = useCallback(
    (id: number | null) => (id == null ? '' : (projects.find((p) => p.id === id)?.name ?? `#${id}`)),
    [projects],
  );

  const hasTool = useCallback(
    (name: string) => toolSpecs.some((t) => t.function.name === name),
    [toolSpecs],
  );

  const filteredChats = useMemo(
    () => (searchQuery.trim()
      ? chats.chats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : chats.chats),
    [chats.chats, searchQuery],
  );

  const submitRename = useCallback(async () => {
    if (renamingId != null && renameValue.trim()) await chats.rename(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, chats]);

  const onSummarize = useCallback(async (id: number) => {
    setSummarizingId(id);
    try { await chats.summarize(id); } finally { setSummarizingId(null); }
  }, [chats]);

  const onDelete = useCallback(async (chat: BrainChat) => {
    const title = chat.title?.trim() || 'this chat';
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(chat.id);
    try { await chats.remove(chat.id); } finally { setDeletingId(null); }
  }, [chats]);

  const onAssign = useCallback(async (chatId: number, projectId: number | null) => {
    setBusyId(chatId);
    try { await chats.assignToProject(chatId, projectId); } finally { setBusyId(null); }
  }, [chats]);

  const createProjectAndAssign = useCallback(async () => {
    const name = newProjectName.trim();
    const target = chats.activeChatId;
    if (!name || target == null || creatingProject) return;
    setCreatingProject(true);
    try {
      const project = await createProject({ name });
      setProjects((prev) => [...prev, project]);
      await chats.assignToProject(target, project.id);
      setShowNewProject(false);
      setNewProjectName('');
    } catch { /* surfaced via chats.error */ } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, chats, creatingProject]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await conv.send(text);
  }, [input, conv]);

  const error = chats.error || conv.error;

  // ---- Shared sub-renders ---------------------------------------------------

  const chatRows = (
    <>
      {chats.loading && <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
      {!chats.loading && filteredChats.length === 0 && (
        <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          {chats.chats.length === 0 ? 'No chats yet. Click + New to start.' : 'No chats match your search.'}
        </div>
      )}
      {filteredChats.map((chat) => {
        const active = chats.activeChatId === chat.id;
        return (
          <div
            key={chat.id}
            className={isPage ? `bs-chat-item ${active ? 'active' : ''}` : undefined}
            role="button"
            tabIndex={0}
            onClick={() => chats.select(chat.id)}
            onKeyDown={(e) => e.key === 'Enter' && chats.select(chat.id)}
            style={isPage ? undefined : {
              padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
              background: active ? 'var(--bg-elevated)' : 'transparent',
              borderLeft: active ? '3px solid var(--coral-bright, #f43f5e)' : '3px solid transparent',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {renamingId === chat.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '100%', fontSize: 13, padding: 2, border: '1px solid var(--border-subtle)', borderRadius: 4 }}
                />
              ) : chat.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {chat.projectId != null && pinnedProjectId == null && (
                <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 4, fontSize: 10 }}>
                  {projectName(chat.projectId)}
                </span>
              )}
              {formatTime(chat.updatedAt)}
            </div>
            {active && renamingId !== chat.id && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => { setRenamingId(chat.id); setRenameValue(chat.title); }} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>Rename</button>
                <button type="button" onClick={() => onSummarize(chat.id)} disabled={summarizingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{summarizingId === chat.id ? '…' : 'Summarize'}</button>
                <button type="button" onClick={() => onDelete(chat)} disabled={deletingId === chat.id} style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer', color: 'var(--coral-bright)' }}>{deletingId === chat.id ? '…' : 'Delete'}</button>
                {chat.projectId == null && pinnedProjectId == null && (
                  <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Add to:
                    <ThemeSelect
                      ariaLabel="Add chat to project"
                      value=""
                      onChange={(val) => { if (val === '__new__') setShowNewProject(true); else if (val !== '') onAssign(chat.id, Number(val)); }}
                      options={[
                        { value: '', label: 'Add to project…' },
                        { value: '__new__', label: '+ Create new project' },
                        ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                      ]}
                      style={{ marginLeft: 0, minWidth: 120, padding: '2px 6px', fontSize: 11 }}
                    />
                    {busyId === chat.id && <span style={{ color: 'var(--text-muted)' }}>…</span>}
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  const conversation = (
    <>
      {error && (
        <div style={{ margin: '8px 12px 0', padding: '8px 12px', fontSize: 13, background: 'var(--error-bg)', color: 'var(--error-text)', borderRadius: 8 }}>
          {error}
        </div>
      )}
      {chats.activeChatId == null ? (
        <div className={isPage ? 'bs-empty' : undefined} style={isPage ? undefined : { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🧠</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)' }}>Brain</div>
          <div style={{ fontSize: 13 }}>Start a new chat or pick one to begin.</div>
          <button type="button" onClick={() => chats.create()} style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer' }}>
            Start new chat
          </button>
        </div>
      ) : (
        <>
          {isPage && pinnedProjectId == null && (
            <ConversationHeader
              chat={chats.activeChat}
              projects={projects}
              projectName={projectName}
              onAssign={onAssign}
              onNewProject={() => setShowNewProject(true)}
            />
          )}
          {showNewProject && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 12px', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                placeholder="New project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createProjectAndAssign()}
                style={{ flex: 1, padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
              />
              <button type="button" onClick={createProjectAndAssign} disabled={!newProjectName.trim() || creatingProject} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                {creatingProject ? '…' : 'Create & assign'}
              </button>
              <button type="button" onClick={() => { setShowNewProject(false); setNewProjectName(''); }} style={{ padding: '8px 12px', fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
            </div>
          )}
          <div className="bs-messages" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {conv.loadingMessages && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 12 }}>Loading messages…</div>}
            {conv.messages.map((msg) => (
              <ChatMessageBubble
                key={msg.id}
                role={msg.role as 'user' | 'assistant'}
                content={msg.content}
                onApplyCode={hasTool('apply_code_to_active_file') ? (code) => { void runTool('apply_code_to_active_file', { code }); } : undefined}
                onCreateFile={hasTool('create_file') ? (path, content) => { void runTool('create_file', { path, content }); } : undefined}
                actions={
                  msg.role !== 'user' ? (
                    <MessageActions msg={msg} conv={conv} projectId={chats.activeChat?.projectId ?? pinnedProjectId ?? undefined} />
                  ) : undefined
                }
              />
            ))}
            {conv.sending && (
              <ChatMessageBubble role="assistant" content={conv.streamingText} isStreaming={!conv.streamingText} />
            )}
          </div>
          <div className="bs-input-area" style={{ flexShrink: 0, padding: isPage ? undefined : '12px 16px', borderTop: isPage ? undefined : '1px solid var(--border-subtle)' }}>
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              placeholder="Message Brain…"
              disabled={conv.sending}
              rows={2}
              submitOnEnter={false}
              onAttach={conv.attach}
              showBrainIcon={false}
              showVoice
              pendingAttachments={conv.pendingAttachments}
              onRemoveAttachment={conv.removeAttachment}
            />
            {conv.uploading && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Uploading…</div>}
          </div>
        </>
      )}
    </>
  );

  // ---- Layouts (chrome only) ------------------------------------------------

  if (isPage) {
    return (
      <div className="bs-shell" style={{ marginBottom: 0 }}>
        <div className="bs-sidebar">
          <div className="bs-sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>Brain Storm</span>
              <button type="button" onClick={() => chats.create()} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                + New
              </button>
            </div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--muted)' }}>
              Project
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>New chats are added to the selected project.</span>
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
            <input type="search" placeholder="Search chats…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
          </div>
          <div className="bs-chat-list">{chatRows}</div>
        </div>
        <div className="bs-main">{conversation}</div>
      </div>
    );
  }

  // Docked drawer
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <div style={{ flexShrink: 0, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>🧠 Brain</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" onClick={() => chats.create()} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'var(--accent, #3b82f6)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>+ New</button>
          <Link href="/brainstorm" title="Open full Brain Storm" style={{ fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>Expand ↗</Link>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close Brain" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          )}
        </div>
      </div>
      <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: historyOpen ? '1px solid var(--border-subtle)' : 'none' }}>
        <button type="button" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer' }}>
          <span style={{ color: 'var(--text-muted)' }}>Chat history</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{historyOpen ? '▼' : '▶'}</span>
        </button>
      </div>
      {historyOpen && (
        <div style={{ flex: '0 1 35%', minHeight: 80, maxHeight: 240, overflow: 'auto', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ padding: '6px 12px' }}>
            <input type="search" placeholder="Search chats…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </div>
          {chatRows}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{conversation}</div>
    </div>
  );
}

// --- Internal pieces -------------------------------------------------------

function MessageActions({ msg, conv, projectId }: {
  msg: BrainMessage;
  conv: ReturnType<typeof useBrainConversation>;
  projectId?: number;
}) {
  return (
    <ChatMessageActions
      onCopy={() => conv.copyMessage(msg)}
      copied={conv.copiedMessageId === msg.id}
      feedback={conv.feedbackMap[msg.id]}
      onFeedback={(value) => conv.submitFeedback(msg, value)}
      projectId={projectId}
      assistantContent={msg.content}
      conversationMessages={conv.messages.map((m) => ({ role: m.role, content: m.content }))}
    />
  );
}

function ConversationHeader({ chat, projects, projectName, onAssign, onNewProject }: {
  chat: BrainChat | null;
  projects: Project[];
  projectName: (id: number | null) => string;
  onAssign: (chatId: number, projectId: number | null) => void;
  onNewProject: () => void;
}) {
  if (!chat) return null;
  return (
    <div className="bs-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-strong)' }}>{chat.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {chat.projectId == null ? (
          <>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Assign to project:
              <ThemeSelect
                ariaLabel="Assign chat to project"
                value=""
                onChange={(val) => { if (val === '__new__') onNewProject(); else if (val !== '') onAssign(chat.id, Number(val)); }}
                options={[
                  { value: '', label: 'No project' },
                  { value: '__new__', label: '+ Create new project' },
                  ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                ]}
                style={{ minWidth: 140, padding: '4px 8px', fontSize: 12 }}
              />
            </label>
            <button type="button" onClick={onNewProject} style={{ fontSize: 12, padding: '4px 8px', cursor: 'pointer', fontWeight: 600, color: 'var(--accent)' }}>+ Project</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{projectName(chat.projectId)}</span>
            <Link href={`/workflows?projectId=${chat.projectId}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>Workflows →</Link>
            <Link href={`/ide/${chat.projectId}?chat=${chat.id}`} style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', textDecoration: 'none', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--coral-bright)' }}>Open in IDE →</Link>
          </>
        )}
      </div>
    </div>
  );
}
