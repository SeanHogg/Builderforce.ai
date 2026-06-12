'use client';

import { Select } from '@/components/Select';

import React, { useEffect, useState } from 'react';
import type { Project } from '@/lib/types';
import { fetchProjects } from '@/lib/api';
import { tasksApi } from '@/lib/builderforceApi';

export interface DeleteProjectDialogProps {
  /** The project to delete; null keeps the dialog closed. */
  project: Project | null;
  onCancel: () => void;
  /**
   * Called to actually delete the project, after any open tasks have already been
   * moved off it (when the user chose to move rather than delete them). The caller
   * owns the delete request + its own list/state cleanup.
   */
  onConfirm: (project: Project) => void;
}

type TaskDisposition = 'move' | 'delete';

/**
 * Confirms project deletion and, when the board still has open tasks, lets the
 * user either move those tasks to another board or delete them along with the
 * project. It loads the board's open tasks and the destination board list itself
 * and performs the move (so it happens before the cascade delete); the project
 * deletion itself is delegated to {@link onConfirm}.
 *
 * Shared by every project-delete entry point (project cards, the details panel,
 * the projects table) so the "what happens to open tasks?" prompt lives in one
 * place.
 */
export function DeleteProjectDialog({ project, onCancel, onConfirm }: DeleteProjectDialogProps) {
  const [openTaskIds, setOpenTaskIds] = useState<number[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [destinations, setDestinations] = useState<Project[]>([]);
  const [disposition, setDisposition] = useState<TaskDisposition>('move');
  const [moveTargetId, setMoveTargetId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDisposition('move');
    setMoveTargetId('');
    setArchivedCount(0);
    (async () => {
      try {
        const [tasks, projects] = await Promise.all([
          tasksApi.list(project.id).catch(() => []),
          fetchProjects().catch(() => [] as Project[]),
        ]);
        if (cancelled) return;
        const open = tasks.filter((t) => !t.archived);
        const others = projects.filter((p) => p.id !== project.id);
        setOpenTaskIds(open.map((t) => t.id));
        // Archived tasks are NOT offered a move — the cascade delete takes them with
        // the project. Surface the count so the loss is explicit (gap [1244]).
        setArchivedCount(tasks.length - open.length);
        setDestinations(others);
        // No other board to move to → only deletion is possible.
        setDisposition(others.length === 0 ? 'delete' : 'move');
        setMoveTargetId(others[0] ? String(others[0].id) : '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  if (!project) return null;

  const hasOpenTasks = openTaskIds.length > 0;
  const willMove = hasOpenTasks && disposition === 'move';
  const confirmDisabled = busy || loading || (willMove && !moveTargetId);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // Move tasks off the board first; the project delete cascade would otherwise
      // take them with it.
      if (willMove) {
        const targetId = Number(moveTargetId);
        for (const id of openTaskIds) {
          await tasksApi.move(id, targetId);
        }
      }
      onConfirm(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move tasks');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '90%',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>
          {`Delete project "${project.name}"? This cannot be undone.`}
        </p>

        {loading ? (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>Checking tasks…</p>
        ) : hasOpenTasks ? (
          <div style={{ marginTop: 16 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
              This board has {openTaskIds.length} open task{openTaskIds.length !== 1 ? 's' : ''}. What
              should happen to {openTaskIds.length !== 1 ? 'them' : 'it'}?
            </p>

            {destinations.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
                <input
                  type="radio"
                  name="task-disposition"
                  checked={disposition === 'move'}
                  onChange={() => setDisposition('move')}
                />
                <span>Move to</span>
                <Select
                  value={moveTargetId}
                  disabled={disposition !== 'move'}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    fontSize: 13,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {destinations.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="radio"
                name="task-disposition"
                checked={disposition === 'delete'}
                onChange={() => setDisposition('delete')}
              />
              <span>Delete {openTaskIds.length !== 1 ? 'them' : 'it'} along with the project</span>
            </label>
          </div>
        ) : null}

        {!loading && archivedCount > 0 && (
          <p style={{ marginTop: 16, fontSize: 13, color: 'var(--warning-text, var(--error-text))' }}>
            {archivedCount} archived task{archivedCount !== 1 ? 's' : ''} will be permanently deleted.
          </p>
        )}

        {error && (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--error-text)' }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-base)',
              color: 'var(--text-secondary)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={(e) => { e.stopPropagation(); handleConfirm(); }}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--coral-bright)',
              borderRadius: 8,
              background: 'var(--coral-bright)',
              color: '#fff',
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.6 : 1,
            }}
          >
            {busy ? 'Deleting…' : willMove ? 'Move tasks & delete' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
