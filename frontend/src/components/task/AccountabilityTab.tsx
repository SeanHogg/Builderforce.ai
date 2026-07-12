'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { kanbanApi } from '@/lib/builderforceApi';
import type { AccountabilityReport, ManifestParticipant, JobRole } from '@/lib/kanban';
import { usePermission } from '@/lib/rbac';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';

/**
 * "Sign-off & Accountability" tab of the ticket detail — the operator's headline
 * surface (PRD-coordinated-role-participation.md §5.9). For every required role it
 * shows Who signed, When, Verdict, Comments and the linked Contribution, plus the
 * gaps (unstaffed/unsigned roles, sign-offs with no contribution, waivers) and the
 * ticket's real %-complete. Managers can run a Resource Assessment (add a needed
 * role — designer, security engineer) and materialize the work items.
 */

const STATE_TONE: Record<string, { bg: string; fg: string }> = {
  completed:          { bg: 'var(--success-bg, #dcfce7)', fg: 'var(--success-text, #166534)' },
  waived:             { bg: 'var(--warning-bg, #fef9c3)', fg: 'var(--warning-text, #854d0e)' },
  in_progress:        { bg: 'var(--info-bg, #dbeafe)',   fg: 'var(--info-text, #1e40af)' },
  assigned:           { bg: 'var(--bg-deep, #eef2ff)',   fg: 'var(--text-secondary, #475569)' },
  changes_requested:  { bg: 'var(--danger-bg, #fee2e2)', fg: 'var(--danger-text, #991b1b)' },
  unstaffed:          { bg: 'var(--danger-bg, #fee2e2)', fg: 'var(--danger-text, #991b1b)' },
  pending:            { bg: 'var(--bg-deep, #f1f5f9)',   fg: 'var(--text-muted, #64748b)' },
  skipped:            { bg: 'var(--bg-deep, #f1f5f9)',   fg: 'var(--text-muted, #64748b)' },
};

function StateChip({ state, label }: { state: string; label: string }) {
  const tone = STATE_TONE[state] ?? STATE_TONE.pending;
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function ContributionLinks({ p }: { p: ManifestParticipant }) {
  // The contribution lives on the sign-off; the manifest carries evidence + child link.
  const items: string[] = [];
  if (p.childTaskId != null) items.push(`#${p.childTaskId}`);
  return items.length ? <span style={{ color: 'var(--text-secondary)' }}>{items.join(' · ')}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>;
}

export function AccountabilityTab({ taskId }: { taskId: number }) {
  const t = useTranslations('accountability');
  const canManage = usePermission('manager.manage').allowed;

  const [report, setReport] = useState<AccountabilityReport | null>(null);
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addRole, setAddRole] = useState('');
  const [addNote, setAddNote] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    kanbanApi.accountability(taskId)
      .then((r) => { setReport(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { kanbanApi.listRoles().then(setRoles).catch(() => setRoles([])); }, []);

  const signoffByRole = useMemo(() => {
    const m = new Map<string, AccountabilityReport['signoffs'][number]>();
    for (const s of report?.signoffs ?? []) m.set(s.roleKey, s); // last wins = latest
    return m;
  }, [report]);

  const assess = useCallback(async () => {
    if (!addRole) return;
    setBusy(true);
    try {
      await kanbanApi.assessResource(taskId, { roleKey: addRole, note: addNote || undefined });
      setAddRole(''); setAddNote('');
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [taskId, addRole, addNote, load]);

  const materialize = useCallback(async () => {
    setBusy(true);
    try { await kanbanApi.materializeParticipants(taskId); load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [taskId, load]);

  const verdictLabel = (v: string) => t.has(`verdict.${v}` as never) ? t(`verdict.${v}` as never) : v;
  const stateLabel = (s: string) => t.has(`state.${s}` as never) ? t(`state.${s}` as never) : s;

  if (loading) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>{t('loading')}</div>;
  if (error) return <div style={{ padding: 16, color: 'var(--danger-text, #991b1b)' }}>{error}</div>;
  if (!report) return null;

  const required = report.participants.filter((p) => p.required);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
      {/* Summary header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('signedHeader', { done: report.completedCount, total: report.requiredCount })}
        </div>
        <div style={{ flex: 1, minWidth: 120, height: 8, borderRadius: 999, background: 'var(--bg-deep, #e2e8f0)', overflow: 'hidden' }}>
          <div style={{ width: `${report.percentComplete}%`, height: '100%', background: report.percentComplete >= 100 ? 'var(--success, #16a34a)' : 'var(--coral-bright, #f97316)' }} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{report.percentComplete}%</div>
      </div>

      {/* Gaps */}
      {report.gaps.length > 0 && (
        <div style={{ border: '1px solid var(--danger-border, #fecaca)', background: 'var(--danger-bg, #fef2f2)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger-text, #991b1b)', marginBottom: 6 }}>{t('gaps.title', { count: report.gaps.length })}</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {report.gaps.map((g, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--danger-text, #991b1b)' }}>
                <strong>{g.roleName}</strong> — {t.has(`gaps.kind.${g.kind}` as never) ? t(`gaps.kind.${g.kind}` as never) : g.kind}: {g.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sign-off & Accountability table */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{t('table.title')}</div>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('table.role')}</th>
                <th style={thStyle}>{t('table.who')}</th>
                <th style={thStyle}>{t('table.state')}</th>
                <th style={thStyle}>{t('table.verdict')}</th>
                <th style={thStyle}>{t('table.when')}</th>
                <th style={thStyle}>{t('table.comments')}</th>
                <th style={thStyle}>{t('table.contribution')}</th>
              </tr>
            </thead>
            <tbody>
              {required.length === 0 && (
                <tr style={trStyle}><td style={tdMutedStyle} colSpan={7}>{t('table.empty')}</td></tr>
              )}
              {required.map((p) => {
                const so = signoffByRole.get(p.roleKey);
                return (
                  <tr key={p.id} style={trStyle}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.roleName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.has(`responsibility.${p.responsibility}` as never) ? t(`responsibility.${p.responsibility}` as never) : p.responsibility}{p.source !== 'template' ? ` · ${t('addedBadge')}` : ''}</div>
                    </td>
                    <td style={tdStyle}>{so?.memberName ?? p.assigneeName ?? <span style={{ color: 'var(--text-muted)' }}>{t('unassigned')}</span>}</td>
                    <td style={tdStyle}><StateChip state={p.state} label={stateLabel(p.state)} /></td>
                    <td style={tdStyle}>{so ? verdictLabel(so.verdict) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={tdMutedStyle}>{so ? new Date(so.createdAt).toLocaleString() : '—'}</td>
                    <td style={tdMutedStyle}>{so?.summary ?? so?.waiveReason ?? '—'}</td>
                    <td style={tdStyle}><ContributionLinks p={p} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resource Assessment (manager) */}
      {canManage && (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('assess.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('assess.help')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              aria-label={t('assess.rolePlaceholder')}
              style={{ padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}
            >
              <option value="" style={{ background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}>{t('assess.rolePlaceholder')}</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key} style={{ background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}>{r.name}</option>
              ))}
            </select>
            <input
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
              placeholder={t('assess.notePlaceholder')}
              style={{ flex: 1, minWidth: 160, padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={assess}
              disabled={!addRole || busy}
              style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: addRole && !busy ? 'pointer' : 'not-allowed', background: 'var(--coral-bright, #f97316)', color: '#fff', opacity: addRole && !busy ? 1 : 0.6 }}
            >
              {t('assess.add')}
            </button>
          </div>
          <div>
            <button
              onClick={materialize}
              disabled={busy}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {t('assess.materialize')}
            </button>
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>{t('assess.materializeHelp')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
