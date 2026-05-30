'use client';

import { useState, useCallback } from 'react';
import { generatePrd, savePrd, generateTasks, saveTasks } from '@/lib/brain';
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
      const prd = await generatePrd({ assistantContent, conversationMessages });
      if (prd.trim()) setPrdModal({ prd: prd.trim() });
      else setError('No PRD content generated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PRD');
    } finally {
      setPrdLoading(false);
    }
  }, [assistantContent, conversationMessages]);

  const handleSavePrd = useCallback(async () => {
    if (!prdModal) return;
    setError(null);
    try {
      await savePrd(projectId, prdModal.prd);
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
      const { titles, descriptions } = await generateTasks(assistantContent);
      if (titles.length > 0) setTasksModal({ titles, descriptions });
      else setError('No tasks extracted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate tasks');
    } finally {
      setTasksLoading(false);
    }
  }, [assistantContent]);

  const handleAddAllTasks = useCallback(async () => {
    if (!tasksModal) return;
    setError(null);
    try {
      await saveTasks(projectId, { titles: tasksModal.titles, descriptions: tasksModal.descriptions });
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
