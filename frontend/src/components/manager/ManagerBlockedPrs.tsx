'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { managerApi, type ManagerBlockedPr, type CloseBlockedPrsResult } from '@/lib/builderforceApi';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';

/**
 * PULL REQUESTS WAITING ON A PERSON — and the one action that clears them.
 *
 * Retiring a PR to a human is the correct end for a branch the manager cannot merge: it
 * turns an invisible livelock into visible work. But visible work nobody can act on
 * in-product is just a longer list. Measured on project 11 the pile went 49 → 52 → 72 →
 * 75 across two days against 381 open PRs; its generator is fixed, so it no longer grows,
 * and every one already there still had to be closed by hand on the provider.
 *
 * The rows whose TICKET IS ALREADY DONE are the ones that need no judgement — the work
 * landed another way and the branch is litter. Those, and only those, are bulk-closable
 * here; the server re-verifies each one, so a list rendered ten minutes ago cannot close
 * a PR whose ticket has since reopened. Every other blocked PR is a decision about
 * unfinished work and stays a per-PR link out to the provider.
 */

const panelStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};
// Name the ROLE, never the size: `.ui-text-*` carries weight, tracking and line
// height together, which is what keeps three "card titles" from being three sizes.
const sectionTitleClass = 'ui-text-card-title';
const mutedClass = 'ui-text-small';
const mutedStyle: CSSProperties = { color: 'var(--text-muted)' };
const headerRowStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start',
  justifyContent: 'space-between', gap: 12, marginBottom: 8,
};
const actionButtonStyle: CSSProperties = {
  // Coral = destructive, matching the confirm dialog this button opens.
  background: 'var(--danger-bg, var(--bg-base))',
  color: 'var(--danger-text, var(--text-primary))',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  // Coarse-pointer parity — a 44px target on touch.
  minHeight: 44,
};
const linkStyle: CSSProperties = { color: 'var(--accent-text, var(--text-primary))', textDecoration: 'underline' };

export interface ManagerBlockedPrsProps {
  projectId: number;
  /** The ranked pile from the manager overview. Passed in rather than re-fetched: the
   *  parent already holds the overview and a second call would be a pure duplicate. */
  blockedPrs: ManagerBlockedPr[];
  /** The TOTAL pile size — the list is the top slice by business value. */
  total: number;
  /** Ask the parent to re-read the overview after a close. */
  onChanged?: () => void;
}

/** Rows whose ticket already finished: the ones a person would close without looking. */
export function closableRows(rows: readonly ManagerBlockedPr[]): ManagerBlockedPr[] {
  return rows.filter((p) => p.taskStatus === 'done');
}

export default function ManagerBlockedPrs({ projectId, blockedPrs, total, onChanged }: ManagerBlockedPrsProps) {
  const t = useTranslations('manager.blockedPrs');
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CloseBlockedPrsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(new Set());

  const rows = useMemo(
    () => blockedPrs.filter((p) => !closedIds.has(p.id)),
    [blockedPrs, closedIds],
  );
  const closable = useMemo(() => closableRows(rows), [rows]);

  if (total === 0 && rows.length === 0) return null;

  const onBulkClose = async () => {
    const ids = closable.map((p) => p.id);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t('confirm.title'),
      message: t('confirm.message', { count: ids.length }),
      confirmLabel: t('confirm.action'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await managerApi.closeBlockedPrs(projectId, ids);
      setResult(res);
      // Drop what actually closed straight away; the parent's refetch reconciles the rest.
      setClosedIds((prev) => new Set([...prev, ...res.closedIds]));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={headerRowStyle}>
        <div style={{ minWidth: 0 }}>
          <div className={sectionTitleClass}>{t('title', { count: total })}</div>
          <div className={mutedClass} style={mutedStyle}>{t('caption')}</div>
        </div>
        {closable.length > 0 && (
          <button type="button" className="ui-text-small" style={actionButtonStyle} onClick={onBulkClose} disabled={busy}>
            {busy ? t('action.working') : t('action.closeDone', { count: closable.length })}
          </button>
        )}
      </div>

      {error && <div className={mutedClass} style={{ color: 'var(--danger-text, var(--text-primary))' }}>{error}</div>}
      {result && (
        <div className={mutedClass} style={{ ...mutedStyle, marginBottom: 8 }}>
          {t('result.summary', { closed: result.closed, skipped: result.skipped.length })}
          {result.truncated && ` ${t('result.truncated', { max: result.max ?? 0 })}`}
        </div>
      )}

      {rows.length === 0 ? (
        <div className={mutedClass} style={mutedStyle}>{t('empty')}</div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={{ ...thStyle, width: 90 }}>{t('col.pr')}</th>
                <th style={thStyle}>{t('col.ticket')}</th>
                <th style={{ ...thStyle, width: 90 }}>{t('col.value')}</th>
                <th style={thStyle}>{t('col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pr) => {
                const done = pr.taskStatus === 'done';
                return (
                  <tr key={pr.id} style={trStyle}>
                    <td style={tdStyle}>
                      {pr.url ? (
                        <a href={pr.url} target="_blank" rel="noreferrer" style={linkStyle}>
                          {pr.number == null ? t('col.pr') : `#${pr.number}`}
                        </a>
                      ) : (
                        <span>{pr.number == null ? '—' : `#${pr.number}`}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{pr.taskKey ?? t('row.noTicket')}</div>
                      <div className={mutedClass} style={mutedStyle}>{pr.title ?? ''}</div>
                      {done && <div className={mutedClass} style={{ color: 'var(--warning-text, var(--text-muted))' }}>{t('row.ticketDone')}</div>}
                    </td>
                    <td style={tdMutedStyle}>{pr.businessValue ?? '—'}</td>
                    <td style={tdMutedStyle}>{pr.reason ?? t('row.blocked')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > rows.length + closedIds.size && (
        <div className={mutedClass} style={{ ...mutedStyle, marginTop: 8 }}>
          {t('more', { count: total - rows.length - closedIds.size })}
        </div>
      )}
    </div>
  );
}
