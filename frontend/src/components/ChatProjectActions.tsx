'use client';

import { useState, useCallback } from 'react';
import { generatePrd, savePrd, generateTasks, saveTasks } from '@/lib/brain';
import { PrdReviewModal, TasksReviewModal } from './ArtifactReviewModals';

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

      {prdModal && (
        <PrdReviewModal prd={prdModal.prd} onCancel={() => setPrdModal(null)} onConfirm={handleSavePrd} />
      )}

      {tasksModal && (
        <TasksReviewModal
          titles={tasksModal.titles}
          descriptions={tasksModal.descriptions}
          onCancel={() => setTasksModal(null)}
          onConfirm={handleAddAllTasks}
        />
      )}
    </>
  );
}
