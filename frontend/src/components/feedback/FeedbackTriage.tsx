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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  FEEDBACK_KINDS, FEEDBACK_STATUSES, isGated,
  type FeedbackKind, type FeedbackQueue, type FeedbackStatus, type FeedbackSubmission,
} from '@/lib/feedbackApi';
import { useFormat } from "@/i18n/useFormat";
import { faultMessage } from '@/lib/apiClient';
import { statusPillStyle, type StatusToneMap } from '@/lib/statusTone';
import { usePanelTask } from '@/hooks/usePanelTask';
const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 16,
};
const btnPrimary: React.CSSProperties = {
  padding: '7px 13px', fontSize: 13, fontWeight: 600, background: 'var(--coral-bright)', color: 'var(--text-on-accent)',
  border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '7px 11px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const chip: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em',
  padding: '2px 8px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
};

/** Anything not yet decided reads as awaiting a person (the fallback, too). */
const STATUS_TONE: StatusToneMap<FeedbackStatus> = {
  new: 'warning',
  approved: 'success',
  declined: 'neutral',
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
  const [loadError, setLoadError] = useState<string | null>(null);
  // The approve/decline in flight, and which card it is about.
  const task = usePanelTask();
  const [decidingId, setDecidingId] = useState<string | null>(null);

  /**
   * Reload plumbing, in three parts, so no dependency list has to lie.
   *
   * The suppression this replaced (`eslint-disable exhaustive-deps` on a `load`
   * the effect called but did not depend on) was hiding a real design problem:
   * `refresh` was recreated whenever the fetch was, so anything that depended on
   * it inherited the churn, and a caller passing an inline loader would have spun.
   * Moving the loader OUT of the dependency graph is what fixes it structurally:
   *
   *   loadRef  — always holds the CURRENT loader, so the fetch effect can call the
   *              latest one without taking its identity as a dependency.
   *   nonce    — the explicit "go again" signal. Because it is a number, `refresh`
   *              closes over nothing and is stable FOREVER, which is what lets
   *              `decide` (and any future caller) hold onto it safely.
   *   the effect— depends on exactly what changes WHAT it fetches: the status
   *              filter, the caller's refreshKey, and explicit reload requests.
   */
  const loadRef = useRef(load);
  const seenInputs = useRef<{ load: FeedbackTriageProps['load']; refreshKey: FeedbackTriageProps['refreshKey'] }>({ load, refreshKey });
  const [reloadNonce, setReloadNonce] = useState(0);
  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  // Keep the ref pointing at the CURRENT loader, and ask for exactly ONE reload
  // when either caller input actually changed. Comparing against what we last
  // fetched with — rather than making `load` a dependency of the fetch — is what
  // keeps an unstable loader safe: this effect can only re-run when the PARENT
  // re-renders, which our own state updates never cause, so there is no cycle.
  // Collapsing both inputs into one signal also stops the common case (a project
  // switch changes `refreshKey` AND rebuilds `load`) from firing two requests.
  useEffect(() => {
    loadRef.current = load;
    const seen = seenInputs.current;
    if (seen.load === load && seen.refreshKey === refreshKey) return;
    seenInputs.current = { load, refreshKey };
    refresh();
  }, [load, refreshKey, refresh]);

  useEffect(() => {
    // Guard against an out-of-order resolve: switching the filter twice quickly
    // could otherwise let the FIRST response overwrite the second's results.
    let active = true;
    setLoading(true);
    loadRef.current(status)
      .then((q) => { if (active) { setQueue(q); setLoadError(null); } })
      .catch((e) => { if (active) setLoadError(faultMessage(e, t('triage.loadFailed'))); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, reloadNonce, t]);

  const decide = async (s: FeedbackSubmission, decision: 'approved' | 'declined') => {
    if (decision === 'declined' && !(await confirm(t('triage.confirmDecline')))) return;
    setDecidingId(s.id);
    // `review` may resolve to nothing, so success is marked explicitly — `run` resolves
    // to `undefined` only when the decision failed.
    const recorded = await task.run(async () => { await review(s, decision); return true; }, { failure: t('triage.reviewFailed') });
    if (recorded) refresh();
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
            onChange={(e) => { task.clear(); setStatus((e.target.value || null) as FeedbackStatus | null); }}
            style={{
              padding: '6px 10px', fontSize: 13, borderRadius: 'var(--radius-md)',
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

      {(task.error ?? loadError) && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{task.error ?? loadError}</div>}

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
            busy={task.busy && decidingId === s.id}
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
  const fmt = useFormat();
  const t = useTranslations('feedback');
  const [expanded, setExpanded] = useState(false);
  const pending = s.status === 'new';
  const gated = isGated(s);


  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...chip, background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          {t(`kind.${safeKind(s.kind)}`)}
        </span>
        <span style={{ ...chip, ...statusPillStyle(STATUS_TONE, s.status, 'warning') }}>{t(`status.${safeStatus(s.status)}`)}</span>
        <div style={{ flex: '1 1 200px', minWidth: 0, fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          {s.title}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {showTenant && s.tenantName && <span>{s.tenantName}</span>}
        {s.projectName && <span>{s.projectName}</span>}
        <span>{fmt.dateTime(s.createdAt)}</span>
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
          marginTop: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', fontSize: 12,
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
