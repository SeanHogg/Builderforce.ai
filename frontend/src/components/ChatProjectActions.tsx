'use client';

import { useState, useCallback } from 'react';
import { sendAIMessageAndCollect } from '@/lib/api';
import { specsApi, tasksApi } from '@/lib/builderforceApi';
import { ChatMessageContent } from './ChatMessageContent';

interface ChatProjectActionsProps {
  projectId: number;
  /** The assistant message content (for Generate Tasks). */
  assistantContent: string;
  /** Full conversation for PRD generation: [{ role, content }, ...]. If not provided, uses assistantContent only. */
  conversationMessages?: Array<{ role: string; content: string }>;
  onPrdSaved?: () => void;
  onTasksAdded?: () => void;
}

export function ChatProjectActions({
  projectId,
  assistantContent,
  conversationMessages,
  onPrdSaved,
  onTasksAdded,
}: ChatProjectActionsProps) {
  const [prdLoading, setPrdLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [prdModal, setPrdModal] = useState<{ prd: string } | null>(null);
  const [tasksModal, setTasksModal] = useState<{ titles: string[]; descriptions: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGeneratePrd = useCallback(async () => {
    setError(null);
    setPrdLoading(true);
    try {
      const conversationText =
        conversationMessages && conversationMessages.length > 0
          ? conversationMessages
              .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
              .join('\n\n')
          : assistantContent;
      const messages = [
        {
          role: 'user' as const,
          content: `Generate a Product Requirements Document (PRD) based on the following conversation. Output only the PRD in markdown: clear sections (Overview, Goals, Requirements, etc.). No preamble or "here is the PRD".\n\n---\n\n${conversationText.slice(0, 12000)}`,
        },
      ];
      const prd = await sendAIMessageAndCollect(projectId, messages);
      if (prd.trim()) setPrdModal({ prd: prd.trim() });
      else setError('No PRD content generated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PRD');
    } finally {
      setPrdLoading(false);
    }
  }, [projectId, assistantContent, conversationMessages]);

  const handleSavePrd = useCallback(async () => {
    if (!prdModal) return;
    setError(null);
    try {
      await specsApi.create({
        projectId,
        goal: 'From chat',
        prd: prdModal.prd,
        status: 'draft',
      });
      setPrdModal(null);
      onPrdSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save PRD');
    }
  }, [projectId, prdModal, onPrdSaved]);

  const handleGenerateTasks = useCallback(async () => {
    setError(null);
    setTasksLoading(true);
    try {
      const messages = [
        {
          role: 'user' as const,
          content: `Based on this response, extract or generate a list of actionable tasks. Output one task per line. Each line: "title" or "title | description". No numbering, no bullets, no preamble. Plain lines only.\n\n---\n\n${assistantContent.slice(0, 8000)}`,
        },
      ];
      const text = await sendAIMessageAndCollect(projectId, messages);
      const lines = text
        .split(/\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const titles: string[] = [];
      const descriptions: string[] = [];
      for (const line of lines) {
        const pipe = line.indexOf('|');
        if (pipe >= 0) {
          titles.push(line.slice(0, pipe).trim());
          descriptions.push(line.slice(pipe + 1).trim());
        } else {
          titles.push(line);
          descriptions.push('');
        }
      }
      if (titles.length > 0) setTasksModal({ titles, descriptions });
      else setError('No tasks extracted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate tasks');
    } finally {
      setTasksLoading(false);
    }
  }, [projectId, assistantContent]);

  const handleAddAllTasks = useCallback(async () => {
    if (!tasksModal) return;
    setError(null);
    try {
      for (let i = 0; i < tasksModal.titles.length; i++) {
        await tasksApi.create({
          projectId,
          title: tasksModal.titles[i],
          description: tasksModal.descriptions[i] || null,
        });
      }
      setTasksModal(null);
      onTasksAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add tasks');
    }
  }, [projectId, tasksModal, onTasksAdded]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleGeneratePrd}
          disabled={prdLoading}
          style={{
            fontSize: 11,
            padding: '4px 8px',
            cursor: prdLoading ? 'wait' : 'pointer',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {prdLoading ? '…' : 'Generate PRD'}
        </button>
        <button
          type="button"
          onClick={handleGenerateTasks}
          disabled={tasksLoading}
          style={{
            fontSize: 11,
            padding: '4px 8px',
            cursor: tasksLoading ? 'wait' : 'pointer',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          {tasksLoading ? '…' : 'Generate Tasks'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 8, padding: 8, fontSize: 12, background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: 6 }}>
          {error}
        </div>
      )}

      {/* PRD modal */}
      {prdModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setPrdModal(null)}
        >
          <div
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              maxWidth: 720,
              maxHeight: '85vh',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
              Generated PRD
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16, fontSize: 13, lineHeight: 1.6 }}>
              <ChatMessageContent content={prdModal.prd} />
            </div>
            <div style={{ padding: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setPrdModal(null)} style={{ padding: '8px 16px', fontSize: 13, cursor: 'pointer', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                Cancel
              </button>
              <button type="button" onClick={handleSavePrd} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8 }}>
                Save to project PRDs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tasks modal */}
      {tasksModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setTasksModal(null)}
        >
          <div
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              maxWidth: 480,
              maxHeight: '80vh',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 12, borderBottom: '1px solid var(--border-subtle)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
              Generated tasks ({tasksModal.titles.length})
            </div>
            <ul style={{ flex: 1, overflow: 'auto', padding: 16, margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              {tasksModal.titles.map((title, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  <strong>{title}</strong>
                  {tasksModal.descriptions[i] && <span style={{ color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>{tasksModal.descriptions[i]}</span>}
                </li>
              ))}
            </ul>
            <div style={{ padding: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setTasksModal(null)} style={{ padding: '8px 16px', fontSize: 13, cursor: 'pointer', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                Cancel
              </button>
              <button type="button" onClick={handleAddAllTasks} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'var(--coral-bright)', color: '#fff', border: 'none', borderRadius: 8 }}>
                Add all to project tasks
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
