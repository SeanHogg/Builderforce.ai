'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { kanbanApi } from '@/lib/builderforceApi';
import { slotKey, type AccountabilityGap, type AccountabilityReport, type ManifestParticipant, type JobRole } from '@/lib/kanban';
import { usePermission } from '@/lib/rbac';
import { taskStatusLabel } from '@/lib/taskStatus';
import { Select } from '@/components/Select';
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
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 600, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

/**
 * The label a gap line leads with — the SAME words the row's State chip uses, because
 * a banner that says "Unsigned" above a row that says "In progress" reads as two
 * disagreeing sources. Only genuinely-wrong gaps keep their own kind label.
 */
function gapLabelKey(g: AccountabilityGap): string {
  return g.kind === 'unsigned' && g.state ? `state.${g.state}` : `gaps.kind.${g.kind}`;
}

/** The sentence under it, derived from the slot's real state rather than one catch-all string. */
function gapDetailKey(g: AccountabilityGap): string {
  if (g.kind === 'waived') return g.reason ? 'gaps.detail.waived' : 'gaps.detail.waived_no_reason';
  if (g.kind !== 'unsigned') return `gaps.detail.${g.kind}`;
  return g.state === 'pending' || g.state === 'assigned' || g.state === 'in_progress'
    ? `gaps.detail.${g.state}`
    : 'gaps.detail.unsigned';
}

const GAP_TONE = {
  blocking: { border: 'var(--danger-border, #fecaca)', bg: 'var(--danger-bg, #fef2f2)', fg: 'var(--danger-text, #991b1b)' },
  advisory: { border: 'var(--warning-border, #fed7aa)', bg: 'var(--warning-bg, #fffbeb)', fg: 'var(--warning-text, #854d0e)' },
} as const;

/**
 * One bucket of gaps. Rendered twice — blocking (red) and advisory (amber) — instead of
 * one red list, so "this role has not signed off yet" stops being reported as an error
 * next to a table showing that role happily in progress.
 */
function GapList({ gaps, tone, title }: { gaps: AccountabilityGap[]; tone: keyof typeof GAP_TONE; title: string }) {
  const t = useTranslations('accountability');
  if (gaps.length === 0) return null;
  const c = GAP_TONE[tone];
  const tr = (key: string, values?: Record<string, string>) => (t.has(key as never) ? t(key as never, values as never) : key);
  return (
    <div style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: 'var(--radius-lg)', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: c.fg, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {gaps.map((g, i) => (
          <li key={`${g.stageKey ?? ''}:${g.roleKey}:${g.kind}:${i}`} style={{ fontSize: 12, color: c.fg }}>
            <strong>{g.roleName}</strong>
            {g.responsibility ? ` · ${tr(`responsibility.${g.responsibility}`)}` : ''}
            {g.stageKey ? ` · ${taskStatusLabel(g.stageKey)}` : ''}
            {' — '}
            {tr(gapLabelKey(g))}: {tr(gapDetailKey(g), g.reason ? { reason: g.reason } : undefined)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContributionLinks({ p, contribution }: { p: ManifestParticipant; contribution?: AccountabilityReport['signoffs'][number]['contribution'] }) {
  const t = useTranslations('accountability');
  const evidence = contribution ?? p.evidence;
  const labels: string[] = [];
  if (p.childTaskId != null) labels.push(`#${p.childTaskId}`);
  if (evidence?.executionId != null) labels.push(t('contribution.run', { id: evidence.executionId }));
  if (evidence?.prdRevision != null) labels.push(t('contribution.prd', { revision: evidence.prdRevision }));
  if (evidence?.toolRunId) labels.push(t('contribution.test', { id: evidence.toolRunId }));
  if (evidence?.diffFiles?.length) labels.push(t('contribution.files', { count: evidence.diffFiles.length }));
  return (
    <span style={{ color: 'var(--text-secondary)' }}>
      {evidence?.prUrl && <><a href={evidence.prUrl} target="_blank" rel="noreferrer">{t('contribution.pr')}</a>{labels.length ? ' · ' : ''}</>}
      {labels.length ? labels.join(' · ') : evidence?.reviewThreadRef ?? (!evidence?.prUrl ? '—' : '')}
    </span>
  );
}

/** Verdicts a human can record here. `delegated` is an agent-to-agent hand-off,
 *  recorded by the coordinator rather than chosen from this table. */
const HUMAN_VERDICTS = ['approved', 'changes_requested', 'waived'] as const;
type HumanVerdict = (typeof HUMAN_VERDICTS)[number];

/** Verdicts the server requires a written reason for (kanbanRoutes signoff, 400). */
const NEEDS_REASON = new Set<HumanVerdict>(['waived']);

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
  // Inline sign-off: which slot's form is open, and its draft. Only one at a time —
  // this is a deliberate, per-role act, not a bulk approve-everything button.
  const [signing, setSigning] = useState<{ roleKey: string; laneKey: string | null } | null>(null);
  const [verdict, setVerdict] = useState<HumanVerdict>('approved');
  const [summary, setSummary] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    kanbanApi.accountability(taskId)
      .then((r) => { setReport(r); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { kanbanApi.listRoles().then(setRoles).catch(() => setRoles([])); }, []);

  const signoffBySlot = useMemo(() => {
    const m = new Map<string, AccountabilityReport['signoffs'][number]>();
    for (const s of report?.signoffs ?? []) m.set(slotKey(s.laneKey, s.roleKey), s);
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

  /**
   * Record the open slot's sign-off. The SERVER is the authority on who may sign as
   * a role (default-deny capability check, 403 with the reason) — the control is
   * offered to everyone and the refusal is surfaced verbatim rather than guessed at
   * client-side, which would need this component to re-derive role capability.
   */
  const submitSignoff = useCallback(async () => {
    if (!signing) return;
    setBusy(true);
    try {
      await kanbanApi.signoff(taskId, {
        roleKey: signing.roleKey,
        laneKey: signing.laneKey ?? undefined,
        verdict,
        summary: summary.trim() || undefined,
        waiveReason: verdict === 'waived' ? summary.trim() : undefined,
      });
      setSigning(null); setSummary(''); setVerdict('approved');
      setError(null);
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [taskId, signing, verdict, summary, load]);

  const verdictLabel = (v: string) => t.has(`verdict.${v}` as never) ? t(`verdict.${v}` as never) : v;
  const stateLabel = (s: string) => t.has(`state.${s}` as never) ? t(`state.${s}` as never) : s;

  if (loading) return <div style={{ padding: 16, color: 'var(--text-muted)' }}>{t('loading')}</div>;
  if (error) return <div style={{ padding: 16, color: 'var(--danger-text, #991b1b)' }}>{error}</div>;
  if (!report) return null;

  const required = report.participants.filter((p) => p.required);
  const blocking = report.gaps.filter((g) => g.severity === 'blocking');
  const advisory = report.gaps.filter((g) => g.severity !== 'blocking');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
      {/* Summary header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('signedHeader', { done: report.completedCount, total: report.requiredCount })}
        </div>
        <div style={{ flex: 1, minWidth: 120, height: 8, borderRadius: 'var(--radius-full)', background: 'var(--bg-deep, #e2e8f0)', overflow: 'hidden' }}>
          <div style={{ width: `${report.percentComplete}%`, height: '100%', background: report.percentComplete >= 100 ? 'var(--success, #16a34a)' : 'var(--coral-bright, #f97316)' }} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{report.percentComplete}%</div>
      </div>

      {/* Gaps — real problems first, then work simply not done yet. */}
      <GapList gaps={blocking} tone="blocking" title={t('gaps.title', { count: blocking.length })} />
      <GapList gaps={advisory} tone="advisory" title={t('gaps.outstandingTitle', { count: advisory.length })} />

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
                <th style={thStyle}>{t('table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {required.length === 0 && (
                <tr style={trStyle}><td style={tdMutedStyle} colSpan={8}>{t('table.empty')}</td></tr>
              )}
              {required.map((p) => {
                const so = signoffBySlot.get(slotKey(p.stageKey, p.roleKey));
                const open = signing?.roleKey === p.roleKey && signing.laneKey === (p.stageKey ?? null);
                // A slot already satisfied needs no action; everything else is signable.
                const outstanding = p.state !== 'completed' && p.state !== 'waived' && p.state !== 'skipped';
                return (
                  <Fragment key={p.id}>
                    <tr style={trStyle}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.roleName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.has(`responsibility.${p.responsibility}` as never) ? t(`responsibility.${p.responsibility}` as never) : p.responsibility}{p.source !== 'template' ? ` · ${t('addedBadge')}` : ''}</div>
                      </td>
                      <td style={tdStyle}>{so?.memberName ?? p.assigneeName ?? <span style={{ color: 'var(--text-muted)' }}>{t('unassigned')}</span>}</td>
                      <td style={tdStyle}><StateChip state={p.state} label={stateLabel(p.state)} /></td>
                      <td style={tdStyle}>{so ? verdictLabel(so.verdict) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td style={tdMutedStyle}>{so ? new Date(so.createdAt).toLocaleString() : '—'}</td>
                      <td style={tdMutedStyle}>{so?.summary ?? so?.waiveReason ?? '—'}</td>
                      <td style={tdStyle}><ContributionLinks p={p} contribution={so?.contribution} /></td>
                      <td style={tdStyle}>
                        {outstanding && (
                          <button
                            type="button"
                            onClick={() => {
                              setSigning(open ? null : { roleKey: p.roleKey, laneKey: p.stageKey ?? null });
                              setSummary(''); setVerdict('approved');
                            }}
                            style={{
                              padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap',
                              border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                              color: 'var(--text-secondary)', cursor: 'pointer',
                            }}
                          >
                            {open ? t('signoff.cancel') : t('signoff.action')}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr style={trStyle}>
                        <td style={{ ...tdStyle, background: 'var(--bg-deep)' }} colSpan={8}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Select
                              value={verdict}
                              onChange={(e) => setVerdict(e.target.value as HumanVerdict)}
                              aria-label={t('table.verdict')}
                              style={{ padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                            >
                              {HUMAN_VERDICTS.map((v) => (
                                <option key={v} value={v} style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                                  {verdictLabel(v)}
                                </option>
                              ))}
                            </Select>
                            <input
                              value={summary}
                              onChange={(e) => setSummary(e.target.value)}
                              placeholder={NEEDS_REASON.has(verdict) ? t('signoff.reasonRequired') : t('signoff.summaryPlaceholder')}
                              style={{ flex: '1 1 200px', minWidth: 0, padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                            />
                            <button
                              type="button"
                              onClick={submitSignoff}
                              disabled={busy || (NEEDS_REASON.has(verdict) && !summary.trim())}
                              style={{
                                padding: '7px 14px', fontSize: 13, fontWeight: 700, borderRadius: 'var(--radius-md)', border: 'none',
                                background: 'var(--coral-bright, #f97316)', color: 'var(--text-on-accent)',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy || (NEEDS_REASON.has(verdict) && !summary.trim()) ? 0.6 : 1,
                              }}
                            >
                              {busy ? t('signoff.recording') : t('signoff.confirm', { role: p.roleName })}
                            </button>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('signoff.help')}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resource Assessment (manager) */}
      {canManage && (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t('assess.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('assess.help')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              aria-label={t('assess.rolePlaceholder')}
              style={{ padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}
            >
              <option value="" style={{ background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}>{t('assess.rolePlaceholder')}</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key} style={{ background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}>{r.name}</option>
              ))}
            </Select>
            <input
              value={addNote}
              onChange={(e) => setAddNote(e.target.value)}
              placeholder={t('assess.notePlaceholder')}
              style={{ flex: 1, minWidth: 160, padding: '7px 10px', fontSize: 13, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-deep, #ffffff)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={assess}
              disabled={!addRole || busy}
              style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 'var(--radius-md)', border: 'none', cursor: addRole && !busy ? 'pointer' : 'not-allowed', background: 'var(--coral-bright, #f97316)', color: 'var(--text-on-accent)', opacity: addRole && !busy ? 1 : 0.6 }}
            >
              {t('assess.add')}
            </button>
          </div>
          <div>
            <button
              onClick={materialize}
              disabled={busy}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: busy ? 'not-allowed' : 'pointer' }}
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
