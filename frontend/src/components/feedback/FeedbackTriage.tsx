'use client';

/**
 * FeedbackTriage — the ONE queue component behind both triage surfaces: the
 * tenant/project queue (Quality ▸ Feedback) and the superadmin cross-tenant
 * roll-up (/admin ▸ Feedback). They differ only in which loader/reviewer they
 * are handed, so the rendering, filtering, empty states and the approve/decline
 * affordance live here once rather than being duplicated per surface.
 *
 * Approving is the human gate: until it happens, the ticket the request opened
 * cannot be executed by any agent. The card says so explicitly, so nobody has to
 * infer it from the ticket's silence.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  FEEDBACK_KINDS, FEEDBACK_STATUSES, isGated,
  type FeedbackKind, type FeedbackQueue, type FeedbackStatus, type FeedbackSubmission,
} from '@/lib/feedbackApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const btnPrimary: React.CSSProperties = {
  padding: '7px 13px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '7px 11px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
  padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
};

/** Narrow a stored kind/status to a key that definitely exists in the catalogs,
 *  so an unrecognised value renders a sensible label instead of throwing. */
function safeKind(kind: string): FeedbackKind {
  return (FEEDBACK_KINDS as string[]).includes(kind) ? (kind as FeedbackKind) : 'other';
}
function safeStatus(status: string): FeedbackStatus {
  return (FEEDBACK_STATUSES as string[]).includes(status) ? (status as FeedbackStatus) : 'new';
}

export interface FeedbackTriageProps {
  /** Loads a page for the current filter. */
  load: (status: FeedbackStatus | null) => Promise<FeedbackQueue>;
  /** Applies a decision. Receives the whole row so a cross-tenant caller has its tenantId. */
  review: (submission: FeedbackSubmission, decision: 'approved' | 'declined') => Promise<unknown>;
  /** Show the originating workspace (superadmin roll-up only). */
  showTenant?: boolean;
  /** Reload when this changes (e.g. the selected project). */
  refreshKey?: string | number | null;
}

export function FeedbackTriage({ load, review, showTenant = false, refreshKey = null }: FeedbackTriageProps) {
  const t = useTranslations('feedback');
  const confirm = useConfirm();
  const [queue, setQueue] = useState<FeedbackQueue>({ submissions: [], counts: {} });
  const [status, setStatus] = useState<FeedbackStatus | null>('new');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    load(status)
      .then((q) => { setQueue(q); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : t('triage.loadFailed')))
      .finally(() => setLoading(false));
    // `load` is recreated per render by most callers; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refreshKey]);
  useEffect(() => { refresh(); }, [refresh]);

  const decide = async (s: FeedbackSubmission, decision: 'approved' | 'declined') => {
    if (decision === 'declined' && !(await confirm(t('triage.confirmDecline')))) return;
    setBusyId(s.id); setError(null);
    try {
      await review(s, decision);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('triage.reviewFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', flex: '1 1 240px', minWidth: 0 }}>
          {t('triage.intro')}
        </div>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('triage.filter')}
          <Select
            value={status ?? ''}
            onChange={(e) => setStatus((e.target.value || null) as FeedbackStatus | null)}
            style={{
              padding: '6px 10px', fontSize: 13, borderRadius: 8,
              border: '1px solid var(--border-subtle)', background: 'var(--bg-deep)', color: 'var(--text-primary)',
            }}
          >
            <option value="">{t('triage.statusAll')}</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.${s}`)} ({queue.counts[s] ?? 0})</option>
            ))}
          </Select>
        </label>
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #dc2626)' }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('triage.loading')}</div>
      ) : queue.submissions.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--text-muted)' }}>{t('triage.empty')}</div>
      ) : (
        queue.submissions.map((s) => (
          <SubmissionCard
            key={s.id}
            submission={s}
            showTenant={showTenant}
            busy={busyId === s.id}
            onDecide={decide}
          />
        ))
      )}
    </div>
  );
}

function SubmissionCard({ submission: s, showTenant, busy, onDecide }: {
  submission: FeedbackSubmission;
  showTenant: boolean;
  busy: boolean;
  onDecide: (s: FeedbackSubmission, decision: 'approved' | 'declined') => void;
}) {
  const t = useTranslations('feedback');
  const [expanded, setExpanded] = useState(false);
  const pending = s.status === 'new';
  const gated = isGated(s);

  const statusColour = s.status === 'approved'
    ? { background: 'var(--success-soft, rgba(22,163,74,.14))', color: 'var(--success, #16a34a)' }
    : s.status === 'declined'
      ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }
      : { background: 'var(--warning-soft, rgba(217,119,6,.14))', color: 'var(--warning, #b45309)' };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...chip, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {t(`kind.${safeKind(s.kind)}`)}
        </span>
        <span style={{ ...chip, ...statusColour }}>{t(`status.${safeStatus(s.status)}`)}</span>
        <div style={{ flex: '1 1 200px', minWidth: 0, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          {s.title}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {showTenant && s.tenantName && <span>{s.tenantName}</span>}
        {s.projectName && <span>{s.projectName}</span>}
        <span>{new Date(s.createdAt).toLocaleString()}</span>
        {s.submitterName || s.submitterEmail ? <span>{s.submitterName ?? s.submitterEmail}</span> : null}
        {s.appVersion && <span>{s.appVersion}</span>}
        {s.taskKey && <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{s.taskKey}</span>}
      </div>

      <p style={{
        margin: '10px 0 0', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
        ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
      }}>
        {s.body}
      </p>
      {s.body.length > 180 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ ...btnSubtle, marginTop: 8, padding: '4px 8px', background: 'none', border: 'none', color: 'var(--coral-bright)' }}
        >
          {expanded ? t('triage.showLess') : t('triage.showMore')}
        </button>
      )}

      {s.pageUrl && (
        <div style={{ fontSize: 12, marginTop: 8, wordBreak: 'break-all' }}>
          <a href={s.pageUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--coral-bright)' }}>
            {s.pageUrl}
          </a>
        </div>
      )}

      {/* The gate, stated plainly — a ticket that is silent because it is waiting
          for a human reads as a broken ticket unless we say why. */}
      {gated && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: 12,
          background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
        }}>
          {t('triage.gatedNote')}
        </div>
      )}

      {pending && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => onDecide(s, 'approved')}>
            {busy ? t('triage.working') : t('triage.approve')}
          </button>
          <button type="button" style={btnSubtle} disabled={busy} onClick={() => onDecide(s, 'declined')}>
            {t('triage.decline')}
          </button>
        </div>
      )}
    </div>
  );
}
