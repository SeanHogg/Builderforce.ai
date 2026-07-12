'use client';

/**
 * NextStepCard — a single action-item card in the Next Steps Panel.
 *
 * Each card displays:
 *   - Title            (verb-first, ≤10 words)
 *   - Description      (1–2 sentences, why recommended)
 *   - Priority badge   (Urgent / High / Normal, colour-coded)
 *   - Effort pill      (Low / Medium / High pill badge — FR-5)
 *   - Execution-type icon
 *   - "Accept & Execute" primary button (FR-2 — zero-modal)
 *   - Dismiss, Pin, Edit, Share controls (FR-3)
 *   - Inline progress  (spinner → success/error — AC-3)
 *   - Post-execution thumbs-up/down micro-feedback (FR-7)
 *
 * Accessibility (AC-10):
 *   - All interactive controls are <button> or <a> elements.
 *   - Appropriate ARIA labels on every control.
 *   - Role, tabindex, onKeyDown for non‑standard widgets.
 *   - WCAG 2.1 AA contrast ratios (validated via theme CSS variables).
 *   - Reduced-motion respects user preference (CSS).
 */

import {
  useCallback,
  useRef,
  useState,
  memo,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  type Effort,
  type ExecutionType,
  type NextStep,
  type Priority,
  NextStepsApi,
} from '@/lib/nextStepsApi';

/* ── Constants ───────────────────────────────────────────────────────────────── */

const EXECUTION_TYPE_LABELS: Record<ExecutionType, string> = {
  draft_content: 'Draft content',
  run_query: 'Run query',
  create_task: 'Create task',
  open_url: 'Open URL',
  trigger_agent: 'Trigger agent',
  ask_followup: 'Ask follow-up',
};

const EXECUTION_TYPE_ICONS: Record<ExecutionType, string> = {
  draft_content: '📝',
  run_query: '🔍',
  create_task: '✅',
  open_url: '🔗',
  trigger_agent: '🤖',
  ask_followup: '💬',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
};

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/* ── Props ────────────────────────────────────────────────────────────────────── */

export interface NextStepCardProps {
  step: NextStep;
  projectId: number;
  /** Called when the step's status changes (accepted, dismissed, pinned, feedback). */
  onChange?: (updated: NextStep, action: 'accepted' | 'dismissed' | 'pinned' | 'feedback') => void;
  /** Called to let the parent shift focus if the card is removed. */
  onRemove?: () => void;
  /** The card's index in the list; used for drag-and-drop (FR-3). */
  readonly index: number;
}

export const NextStepCard = memo(function NextStepCard({
  step,
  projectId,
  onChange,
  onRemove,
  index,
}: NextStepCardProps) {
  const t = useTranslations('nextSteps');

  /* ── State ─────────────────────────────────────────────────────────────────── */
  const [accepted, setAccepted] = useState(false);
  /** 'idle' | 'executing' | 'success' | 'error' */
  const [execState, setExecState] = useState<'idle' | 'executing' | 'success' | 'error'>('idle');
  const [execMsg, setExecMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pinned, setPinned] = useState(step.pinned ?? false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(step.title);
  const [editDesc, setEditDesc] = useState(step.description);

  const cardRef = useRef<HTMLDivElement>(null);

  const canExecute = !accepted && execState === 'idle';
  const isExecuting = execState === 'executing';

  /* ── Executor ──────────────────────────────────────────────────────────────── */
  const handleExecute = useCallback(async () => {
    if (isExecuting) return;
    setAccepted(true);
    setExecState('executing');
    // Log the accept event (FR-1 style tracking, idempotent).
    NextStepsApi.logStepEvent({
      stepId: step.id,
      eventType: 'accepted',
      timestamp: Date.now(),
      userId: '__user__',
      projectId,
    }).catch(() => { /* best-effort */ });

    try {
      const result = await NextStepsApi.executeStep(
        { ...step, title: editTitle, description: editDesc },
        projectId,
      );

      if (result.success) {
        setExecState('success');
        setExecMsg(result.executionResult
          ? `Done in ${(result.durationMs / 1000).toFixed(1)}s`
          : null);
        onChange?.({ ...step, title: editTitle, description: editDesc, executedAt: Date.now() }, 'accepted');
      } else {
        setExecState('error');
        setExecMsg(result.executionError ?? 'Execution failed. Please try again.');
      }
    } catch (err) {
      setExecState('error');
      setExecMsg(err instanceof Error ? err.message : 'An unexpected error occurred.');
    }
  }, [isExecuting, step, editTitle, editDesc, projectId, onChange]);

  /* ── Dismiss ──────────────────────────────────────────────────────────────── */
  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onChange?.(step, 'dismissed');
    onRemove?.();
    NextStepsApi.logStepEvent({
      stepId: step.id,
      eventType: 'dismissed',
      timestamp: Date.now(),
      userId: '__user__',
      projectId,
    }).catch(() => {});
  }, [step, projectId, onChange, onRemove]);

  /* ── Pin ───────────────────────────────────────────────────────────────────── */
  const handlePin = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    onChange?.({ ...step, pinned: next }, 'pinned');
  }, [pinned, step, onChange]);

  /* ── Share ─────────────────────────────────────────────────────────────────── */
  const handleShare = useCallback(() => {
    // Build a deep link (deep-link to step sharing within the Onboarding flow).
    const url = `${window.location.origin}/onboarding/step/${step.id}`;
    navigator.clipboard.writeText(url).catch(() => { /* Not supported, silently ignore */ });
  }, [step.id]);

  /* ── Feedback ──────────────────────────────────────────────────────────────── */
  const handleFeedback = useCallback((dir: 'up' | 'down') => {
    setFeedback(dir);
    NextStepsApi.logStepEvent({
      stepId: step.id,
      eventType: 'feedback',
      timestamp: Date.now(),
      userId: '__user__',
      projectId,
    }).catch(() => {});
    onChange?.(step, 'feedback');
  }, [step.id, projectId, onChange]);

  /* ── Save edits ────────────────────────────────────────────────────────────── */
  const saveEdits = useCallback(() => {
    onChange?.({ ...step, title: editTitle, description: editDesc }, 'accepted');
    NextStepsApi.logStepEvent({
      stepId: step.id,
      eventType: 'edited',
      timestamp: Date.now(),
      userId: '__user__',
      projectId,
    }).catch(() => {});
    setEditing(false);
  }, [editTitle, editDesc, step, onChange, projectId]);

  /* ── Keyboard ───────────────────────────────────────────────────────────────── */
  const keyHandlers = {
    accept: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleExecute(); }
    },
    dismiss: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDismiss(); }
    },
    pin: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePin(); }
    },
    share: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleShare(); }
    },
    edit: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(!editing); }
    },
    feedback: (dir: 'up' | 'down') => (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFeedback(dir); }
    },
  };

  /* ── Render ────────────────────────────────────────────────────────────────── */
  if (dismissed) return null;

  const isAsync = step.executionType === 'create_task' || step.executionType === 'trigger_agent';

  return (
    <div
      ref={cardRef}
      className={`ns-card${pinned ? ' ns-card-pinned' : ''}${accepted ? ' ns-card-accepted' : ''}`}
      role="listitem"
      aria-roledescription="next-step-card"
      aria-label={`${t('cardLabel')} ${step.title}`}
      style={cardStyle}
      data-index={index}
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
    >

      {/* ── Priority + Type + Effort badges ── */}
      <div className="ns-card-header" style={headerStyle}>
        <span
          className={`ns-badge ns-badge-${step.priority}`}
          style={badgeStyle}
          aria-label={`${t('priority')}: ${PRIORITY_LABELS[step.priority]}`}
        >
          {PRIORITY_LABELS[step.priority]}
        </span>
        <span className="ns-type-icon" aria-hidden="true">
          {EXECUTION_TYPE_ICONS[step.executionType]}
        </span>
        <span className="ns-type-label" style={typeLabelStyle}>
          {EXECUTION_TYPE_LABELS[step.executionType]}
        </span>
        <span
          className={`ns-pill ns-pill-${step.effort}`}
          style={effortPillStyle}
          aria-label={`${t('effort')}: ${EFFORT_LABELS[step.effort]}`}
        >
          {EFFORT_LABELS[step.effort]}
        </span>
      </div>

      {editing ? (
        /* ── Inline edit mode (FR-3) ── */
        <div className="ns-edit-area" style={editAreaStyle}>
          <input
            className="ns-edit-input"
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            aria-label={t('editTitle')}
            style={editInputStyle}
            autoFocus
          />
          <textarea
            className="ns-edit-textarea"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            aria-label={t('editDescription')}
            rows={3}
            style={editTextareaStyle}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="ns-btn ns-btn-save"
              onClick={saveEdits}
              aria-label={t('save')}
              style={smallBtnStyle}
            >
              {t('save')}
            </button>
            <button
              type="button"
              className="ns-btn ns-btn-cancel"
              onClick={() => setEditing(false)}
              aria-label={t('cancel')}
              style={smallBtnStyle}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        /* ── Read-only content ── */
        <>
          <h4 className="ns-card-title" style={titleStyle}>
            {editTitle}
          </h4>
          <p className="ns-card-desc" style={descStyle}>
            {editDesc}
          </p>
        </>
      )}

      {/* ── Execution progress (FR-2, AC-3) ── */}
      {execState === 'executing' && (
        <div className="ns-progress" style={progressStyle} role="status" aria-live="polite">
          <span className="ns-spinner" style={spinnerStyle} aria-hidden="true">
            {isAsync
              ? t('asyncProgress', { type: EXECUTION_TYPE_LABELS[step.executionType] })
              : t('syncProgress', { type: EXECUTION_TYPE_LABELS[step.executionType] })}
          </span>
          <span style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {t('inProgress')}
          </span>
        </div>
      )}
      {execState === 'success' && (
        <div className="ns-result ns-result-success" style={resultStyle('success')} role="status" aria-live="assertive">
          <span>{t('executed')}</span>
          {execMsg && <span style={{ fontSize: '0.7rem', opacity: 0.7, marginLeft: 4 }}>{execMsg}</span>}
        </div>
      )}
      {execState === 'error' && (
        <div className="ns-result ns-result-error" style={resultStyle('error')} role="alert" aria-live="assertive">
          <span>{t('error')}</span>
          {execMsg && <span style={{ fontSize: '0.7rem', opacity: 0.7, marginLeft: 4 }}>{execMsg}</span>}
          <button
            type="button"
            className="ns-retry"
            onClick={handleExecute}
            aria-label={t('retry')}
            style={retryBtnStyle}
          >
            {t('retry')}
          </button>
        </div>
      )}

      {/* ── Actions bar ── */}
      <div className="ns-actions" style={actionsStyle}>
        {/* Primary: Accept & Execute (FR-2) */}
        {canExecute && !editing && (
          <button
            type="button"
            className="ns-btn ns-btn-execute"
            onClick={handleExecute}
            onKeyDown={keyHandlers.accept}
            aria-label={t('acceptAndExecute', { title: step.title })}
            tabIndex={0}
            style={executeBtnStyle}
          >
            {t('acceptAndExecuteLabel')}
          </button>
        )}

        {/* Dismiss (FR-3) */}
        {!accepted && !editing && (
          <button
            type="button"
            className="ns-btn ns-btn-dismiss"
            onClick={handleDismiss}
            onKeyDown={keyHandlers.dismiss}
            aria-label={t('dismiss')}
            tabIndex={0}
            style={smallBtnStyle}
          >
            {t('dismiss')}
          </button>
        )}

        {/* Pin (FR-3) */}
        {!editing && (
          <button
            type="button"
            className={`ns-btn ns-btn-pin${pinned ? ' ns-btn-pinned' : ''}`}
            onClick={handlePin}
            onKeyDown={keyHandlers.pin}
            aria-label={t(pinned ? 'unpin' : 'pin')}
            aria-pressed={pinned}
            tabIndex={0}
            style={smallBtnStyle}
          >
            {pinned ? t('unpin') : t('pin')}
          </button>
        )}

        {/* Edit (FR-3) */}
        {!accepted && (
          <button
            type="button"
            className="ns-btn ns-btn-edit"
            onClick={() => setEditing(!editing)}
            onKeyDown={keyHandlers.edit}
            aria-label={t('edit')}
            tabIndex={0}
            style={smallBtnStyle}
          >
            {t('edit')}
          </button>
        )}

        {/* Share (FR-3) */}
        <button
          type="button"
          className="ns-btn ns-btn-share"
          onClick={handleShare}
          onKeyDown={keyHandlers.share}
          aria-label={t('share')}
          tabIndex={0}
          style={smallBtnStyle}
        >
          {t('share')}
        </button>
      </div>

      {/* ── Post-execution micro-feedback (FR-7, AC-8) ── */}
      {execState !== 'idle' && (
        <div className="ns-feedback" style={feedbackBarStyle} role="group" aria-label={t('feedbackLabel')}>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {t('wasThisHelpful')}
          </span>
          <button
            type="button"
            className={`ns-thumb${feedback === 'up' ? ' ns-thumb-active' : ''}`}
            onClick={() => handleFeedback('up')}
            onKeyDown={keyHandlers.feedback('up')}
            aria-label={t('feedbackUp')}
            aria-pressed={feedback === 'up'}
            tabIndex={0}
            style={thumbBtnStyle}
          >
            👍
          </button>
          <button
            type="button"
            className={`ns-thumb${feedback === 'down' ? ' ns-thumb-active' : ''}`}
            onClick={() => handleFeedback('down')}
            onKeyDown={keyHandlers.feedback('down')}
            aria-label={t('feedbackDown')}
            aria-pressed={feedback === 'down'}
            tabIndex={0}
            style={thumbBtnStyle}
          >
            👎
          </button>
        </div>
      )}
    </div>
  );
});

/* ── Style objects ──────────────────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
  background: 'var(--bg-elevated, #ffffff)',
  border: '1px solid var(--border-subtle, #e0e0e0)',
  borderRadius: 12,
  transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
  cursor: 'grab',
  position: 'relative',
  outline: 'none',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};
const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: '0.65rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const typeLabelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
};
const effortPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 7px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 999,
  fontSize: '0.62rem',
  color: 'var(--text-secondary)',
  fontWeight: 600,
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.88rem',
  fontWeight: 700,
  lineHeight: 1.3,
  color: 'var(--text-primary)',
};
const descStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.76rem',
  lineHeight: 1.5,
  color: 'var(--text-secondary)',
};
const progressStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  background: 'var(--bg-surface)',
  borderRadius: 8,
};
const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '0.75rem',
  fontWeight: 600,
};
const resultStyle = (tone: 'success' | 'error'): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  padding: '6px 8px',
  borderRadius: 8,
  fontSize: '0.74rem',
  fontWeight: 600,
  background: tone === 'success' ? 'var(--green-surface, #e8f5e9)' : 'var(--red-surface, #ffebee)',
  color: tone === 'success' ? 'var(--green-text, #2e7d32)' : 'var(--red-text, #c62828)',
});
const retryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid currentColor',
  borderRadius: 6,
  padding: '0 8px',
  fontSize: '0.68rem',
  fontWeight: 700,
  cursor: 'pointer',
  color: 'inherit',
  marginLeft: 6,
};
const actionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  marginTop: 4,
};
const executeBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--accent-solid, #0052cc)',
  color: '#fff',
  fontSize: '0.76rem',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const smallBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 9px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: '0.68rem',
  fontWeight: 600,
  cursor: 'pointer',
};
const editAreaStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const editInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  fontWeight: 700,
  outline: 'none',
};
const editTextareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '0.75rem',
  resize: 'vertical',
  outline: 'none',
  fontFamily: 'inherit',
};
const feedbackBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingTop: 6,
  borderTop: '1px solid var(--border-subtle)',
};
const thumbBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 6,
  padding: '2px 6px',
  fontSize: '0.85rem',
  cursor: 'pointer',
  lineHeight: 1,
};