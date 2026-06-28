'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import { usePmData } from '@/lib/pm/usePmData';
import {
  alertsApi,
  type Alert,
  type AlertEvent,
  type AlertMetric,
  type AlertComparator,
  type AlertScopeKind,
} from '@/lib/builderforceApi';

const METRICS: AlertMetric[] = [
  'token_spend_usd',
  'token_spend_pct_of_cap',
  'cost_per_merged_pr_usd',
  'dora_change_failure_rate',
  'dora_lead_time_hours',
  'ai_effectiveness_score',
  'eval_drift',
];
const COMPARATORS: AlertComparator[] = ['gt', 'lt', 'gte', 'lte'];
const SCOPES: AlertScopeKind[] = ['tenant', 'project', 'team'];

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--accent, #2563eb)',
  color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtnStyle: React.CSSProperties = {
  ...btnStyle, background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)', padding: '4px 10px',
};

interface DraftRule {
  name: string;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: string;
  windowDays: string;
  scopeKind: AlertScopeKind;
  notifySlack: boolean;
  notifyEmail: boolean;
}

const EMPTY_DRAFT: DraftRule = {
  name: '', metric: 'token_spend_usd', comparator: 'gt', threshold: '',
  windowDays: '7', scopeKind: 'tenant', notifySlack: true, notifyEmail: true,
};

export function AlertsClient() {
  const t = useTranslations('alerts');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
  const [tested, setTested] = useState<Record<string, string>>({});

  const rules = usePmData<{ alerts: Alert[] }>(() => alertsApi.list(), []);
  const events = usePmData<{ events: AlertEvent[] }>(() => alertsApi.listEvents({ limit: 50 }), []);

  const reloadAll = () => { rules.reload(); events.reload(); };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); reloadAll(); } finally { setBusy(false); }
  };

  const metricLabel = (m: AlertMetric | null) => (m ? t(`metric.${m}`) : '—');
  const comparatorLabel = (c: AlertComparator | null) => (c ? t(`comparator.${c}`) : '—');

  const createRule = () =>
    run(async () => {
      await alertsApi.create({
        name: draft.name.trim(),
        metric: draft.metric,
        comparator: draft.comparator,
        threshold: Number(draft.threshold) || 0,
        windowDays: Math.max(1, Math.min(365, Number(draft.windowDays) || 7)),
        scopeKind: draft.scopeKind,
        notifySlack: draft.notifySlack,
        notifyEmail: draft.notifyEmail,
      });
      setDraft(EMPTY_DRAFT);
    });

  const testRule = async (id: string) => {
    try {
      const r = await alertsApi.testRule(id);
      setTested((prev) => ({
        ...prev,
        [id]: r.observedValue == null ? t('test.na') : t('test.observed', { value: fmt(r.observedValue) }),
      }));
    } catch {
      setTested((prev) => ({ ...prev, [id]: t('test.failed') }));
    }
  };

  const canCreate = draft.name.trim().length > 0 && draft.threshold.trim().length > 0;

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('title')}</h1>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('subtitle')}</p>
      </div>

      <RoleGate capability="alerts.manage" variant="block">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Create rule */}
          <PmCard title={t('create.title')}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
              <Field label={t('field.name')}>
                <input style={inputStyle} value={draft.name} placeholder={t('field.namePlaceholder')}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label={t('field.metric')}>
                <select style={inputStyle} value={draft.metric}
                  onChange={(e) => setDraft({ ...draft, metric: e.target.value as AlertMetric })}>
                  {METRICS.map((m) => <option key={m} value={m}>{t(`metric.${m}`)}</option>)}
                </select>
              </Field>
              <Field label={t('field.comparator')}>
                <select style={inputStyle} value={draft.comparator}
                  onChange={(e) => setDraft({ ...draft, comparator: e.target.value as AlertComparator })}>
                  {COMPARATORS.map((c) => <option key={c} value={c}>{t(`comparator.${c}`)}</option>)}
                </select>
              </Field>
              <Field label={t('field.threshold')}>
                <input style={inputStyle} type="number" value={draft.threshold}
                  onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} />
              </Field>
              <Field label={t('field.windowDays')}>
                <input style={inputStyle} type="number" min={1} max={365} value={draft.windowDays}
                  onChange={(e) => setDraft({ ...draft, windowDays: e.target.value })} />
              </Field>
              <Field label={t('field.scope')}>
                <select style={inputStyle} value={draft.scopeKind}
                  onChange={(e) => setDraft({ ...draft, scopeKind: e.target.value as AlertScopeKind })}>
                  {SCOPES.map((s) => <option key={s} value={s}>{t(`scope.${s}`)}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <label style={checkLabel}>
                <input type="checkbox" checked={draft.notifySlack} onChange={(e) => setDraft({ ...draft, notifySlack: e.target.checked })} />
                {t('field.notifySlack')}
              </label>
              <label style={checkLabel}>
                <input type="checkbox" checked={draft.notifyEmail} onChange={(e) => setDraft({ ...draft, notifyEmail: e.target.checked })} />
                {t('field.notifyEmail')}
              </label>
              <button type="button" style={btnStyle} disabled={busy || !canCreate} onClick={createRule}>
                {t('create.submit')}
              </button>
            </div>
          </PmCard>

          {/* Rules */}
          <PmCard title={t('rules.title')}>
            {rules.error ? <PmError message={rules.error} />
              : !rules.data ? <PmEmpty message={t('loading')} />
              : rules.data.alerts.length === 0 ? <PmEmpty message={t('rules.empty')} />
              : (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={theadRowStyle}>
                        <th style={thStyle}>{t('field.name')}</th>
                        <th style={thStyle}>{t('field.metric')}</th>
                        <th style={thStyle}>{t('rules.condition')}</th>
                        <th style={thStyle}>{t('field.windowDays')}</th>
                        <th style={thStyle}>{t('field.scope')}</th>
                        <th style={thStyle}>{t('rules.status')}</th>
                        <th style={thStyle}>{t('rules.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.data.alerts.map((a) => (
                        <tr key={a.id} style={trStyle}>
                          <td style={tdStyle}>{a.name}</td>
                          <td style={tdMutedStyle}>{metricLabel(a.metric)}</td>
                          <td style={tdMutedStyle}>{comparatorLabel(a.comparator)} {fmt(a.threshold)}</td>
                          <td style={tdMutedStyle}>{t('days', { n: a.windowDays })}</td>
                          <td style={tdMutedStyle}>{t(`scope.${a.scopeKind}`)}</td>
                          <td style={tdMutedStyle}>
                            <button type="button" style={ghostBtnStyle} disabled={busy}
                              onClick={() => run(() => alertsApi.update(a.id, { enabled: !a.enabled }))}>
                              {a.enabled ? t('rules.enabled') : t('rules.disabled')}
                            </button>
                          </td>
                          <td style={tdMutedStyle}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              <button type="button" style={ghostBtnStyle} disabled={busy} onClick={() => testRule(a.id)}>
                                {t('rules.test')}
                              </button>
                              <button type="button" style={ghostBtnStyle} disabled={busy}
                                onClick={() => run(() => alertsApi.remove(a.id))}>
                                {t('common.delete')}
                              </button>
                              {tested[a.id] && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{tested[a.id]}</span>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </PmCard>

          {/* Recent events */}
          <PmCard title={t('events.title')}>
            {events.error ? <PmError message={events.error} />
              : !events.data ? <PmEmpty message={t('loading')} />
              : events.data.events.length === 0 ? <PmEmpty message={t('events.empty')} />
              : (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={theadRowStyle}>
                        <th style={thStyle}>{t('events.when')}</th>
                        <th style={thStyle}>{t('field.metric')}</th>
                        <th style={thStyle}>{t('events.message')}</th>
                        <th style={thStyle}>{t('rules.status')}</th>
                        <th style={thStyle}>{t('rules.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.data.events.map((ev) => (
                        <tr key={ev.id} style={trStyle}>
                          <td style={tdMutedStyle}>{new Date(ev.createdAt).toLocaleString()}</td>
                          <td style={tdMutedStyle}>{metricLabel(ev.metric)}</td>
                          <td style={tdStyle}>{ev.message}</td>
                          <td style={tdMutedStyle}>{t(`eventStatus.${ev.status}`)}</td>
                          <td style={tdMutedStyle}>
                            {ev.status === 'triggered' ? (
                              <button type="button" style={ghostBtnStyle} disabled={busy}
                                onClick={() => run(() => alertsApi.ackEvent(ev.id))}>
                                {t('events.acknowledge')}
                              </button>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </PmCard>
        </div>
      </RoleGate>
    </PageContainer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
      {label}
      {children}
    </label>
  );
}

const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--text-secondary)',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
