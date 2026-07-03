'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { tasksApi, type Task, type TaskPriority, type WorkItemKind } from '@/lib/builderforceApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';

/**
 * Create/edit an Epic in a slide-out side panel. Shared by the Epics tree view
 * (the "New epic" button and clicking an epic row) so the Epic CRUD form lives
 * in one place. A null `epic` means create (under `projectId`); a row means edit.
 *
 * Epics are tasks with `taskType === 'epic'`, so this drives `tasksApi.create`
 * ({ taskType: 'epic' }) and `tasksApi.update` — no dedicated epic endpoint.
 */
export interface EpicPanelProps {
  open: boolean;
  /** null = create a new epic, a row = edit that epic. */
  epic: Task | null;
  /** Project the new epic belongs to (create mode). Edit mode uses the epic's own project. */
  projectId: number | null;
  onClose: () => void;
  /** Called after a successful create/update so the caller can reload its data. */
  onSaved: () => void;
}

const STATUSES = ['backlog', 'todo', 'ready', 'in_progress', 'in_review', 'done', 'blocked'] as const;
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block',
};
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14,
};

export function EpicPanel({ open, epic, projectId, onClose, onSaved }: EpicPanelProps) {
  const t = useTranslations('pm');
  const isEdit = epic != null;
  const [title, setTitle] = useState(epic?.title ?? '');
  const [description, setDescription] = useState(epic?.description ?? '');
  const [status, setStatus] = useState(epic?.status ?? 'backlog');
  const [priority, setPriority] = useState<TaskPriority>(epic?.priority ?? 'medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetProjectId = epic?.projectId ?? projectId;

  // Change the item's TYPE (task⇄epic, or promote to an OKR Objective). Promoting
  // to an objective removes this board item and creates a real OKR, so confirm first.
  const convertTo = async (target: WorkItemKind) => {
    if (!epic) return;
    if (target === 'objective' && !window.confirm(t('convertToOkrConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await tasksApi.convertType(epic.id, target);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!title.trim()) { setError(t('epicTitleRequired')); return; }
    if (targetProjectId == null) { setError(t('epicNeedsProject')); return; }
    setBusy(true);
    setError(null);
    try {
      if (isEdit) {
        await tasksApi.update(epic!.id, {
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
        });
      } else {
        await tasksApi.create({
          projectId: targetProjectId,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          taskType: 'epic',
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={isEdit ? t('editEpic') : t('newEpic')}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isEdit && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{epic!.key}</div>
        )}
        <div>
          <label style={labelStyle} htmlFor="epic-title">{t('colEpicTask')}</label>
          <input
            id="epic-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={fieldStyle}
            placeholder={t('epicTitlePlaceholder')}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="epic-desc">{t('epicDescription')}</label>
          <textarea
            id="epic-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...fieldStyle, minHeight: 96, resize: 'vertical' }}
            placeholder={t('epicDescriptionPlaceholder')}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {isEdit && (
            <div>
              <label style={labelStyle} htmlFor="epic-status">{t('colStatus')}</label>
              <Select id="epic-status" value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`epicStatus.${s}`)}</option>)}
              </Select>
            </div>
          )}
          <div>
            <label style={labelStyle} htmlFor="epic-priority">{t('colPriority')}</label>
            <Select id="epic-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} style={fieldStyle}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t(`epicPriority.${p}`)}</option>)}
            </Select>
          </div>
        </div>
        {isEdit && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={labelStyle}>{t('convertTypeHeading')}</label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('convertTypeHint')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => convertTo('objective')}
                disabled={busy}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)',
                  background: 'transparent', color: 'var(--text-primary)', fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer', fontSize: 13,
                }}
              >
                {t('convertToOkr')}
              </button>
              <button
                type="button"
                onClick={() => convertTo('task')}
                disabled={busy}
                style={{
                  padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)',
                  background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer', fontSize: 13,
                }}
              >
                {t('convertToTask')}
              </button>
            </div>
          </div>
        )}
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{
              padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)',
              color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
            }}
          >
            {isEdit ? t('epicSaveChanges') : t('epicCreate')}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border-subtle)',
              background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
            }}
          >
            {t('epicCancel')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
