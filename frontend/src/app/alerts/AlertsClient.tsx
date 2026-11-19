'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';
import { LocalCollection } from '@/components/pm/LocalCollection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { usePmData } from '@/lib/pm/usePmData';
import {
  alertsApi,
  type Alert,
  type AlertEvent,
  type AlertMetric,
  type AlertComparator,
  type AlertScopeKind,
} from '@/lib/builderforceApi';
import { useFormat } from "@/i18n/useFormat";

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
  padding: '7px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)',
};
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)',
  color: 'var(--text-on-accent)', fontWeight: 600, fontSize: 'var(--font-size-small)', cursor: 'pointer', whiteSpace: 'nowrap',
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
  const fmt = useFormat();
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
        [id]: r.observedValue == null ? t('test.na') : t('test.observed', { value: fmt.number(r.observedValue, { maximumFractionDigits: 2 }) }),
      }));
    } catch {
      setTested((prev) => ({ ...prev, [id]: t('test.failed') }));
    }
  };

  const canCreate = draft.name.trim().length > 0 && draft.threshold.trim().length > 0;

  // Read-only Collection descriptors (entity: null) — alert rules/firings have no bulk API;
  // the per-row enable/test/delete/acknowledge actions stay as row controls.
  const ruleDescriptor = useMemo<CollectionDescriptor<Alert>>(() => {
    const statusBtn = (a: Alert) => (
      <button type="button" style={ghostBtnStyle} disabled={busy}
        onClick={() => run(() => alertsApi.update(a.id, { enabled: !a.enabled }))}>
        {a.enabled ? t('rules.enabled') : t('rules.disabled')}
      </button>
    );
    const actions = (a: Alert) => (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={ghostBtnStyle} disabled={busy} onClick={() => testRule(a.id)}>
          {t('rules.test')}
        </button>
        <button type="button" style={ghostBtnStyle} disabled={busy}
          onClick={() => run(() => alertsApi.remove(a.id))}>
          {t('common.delete')}
        </button>
        {tested[a.id] && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{tested[a.id]}</span>}
      </div>
    );
    const condition = (a: Alert) => `${comparatorLabel(a.comparator)} ${fmt.number(a.threshold, { maximumFractionDigits: 2 })}`;
    return {
      entity: null,
      surfaceKey: 'alerts.rules',
      rowId: (a) => a.id,
      label: (a) => a.name,
      defaultSort: { key: 'name', dir: 'asc' },
      emptyKey: 'emptyAlertRules',
      card: (a) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          <span style={{ fontWeight: 600 }}>{a.name}</span>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            {metricLabel(a.metric)} · {condition(a)} · {t('days', { n: a.windowDays })} · {t(`scope.${a.scopeKind}`)}
          </span>
          <div>{statusBtn(a)}</div>
          {actions(a)}
        </div>
      ),
      columns: [
        { key: 'name', header: t('field.name'), sortKey: 'name', compare: (a, b) => a.name.localeCompare(b.name), cell: (a) => a.name },
        { key: 'metric', header: t('field.metric'), sortKey: 'metric', compare: (a, b) => a.metric.localeCompare(b.metric), cell: (a) => metricLabel(a.metric) },
        { key: 'condition', header: t('rules.condition'), cell: condition },
        { key: 'windowDays', header: t('field.windowDays'), sortKey: 'windowDays', compare: (a, b) => a.windowDays - b.windowDays, cell: (a) => t('days', { n: a.windowDays }) },
        { key: 'scope', header: t('field.scope'), sortKey: 'scope', compare: (a, b) => a.scopeKind.localeCompare(b.scopeKind), cell: (a) => t(`scope.${a.scopeKind}`) },
        { key: 'status', header: t('rules.status'), sortKey: 'status', compare: (a, b) => Number(b.enabled) - Number(a.enabled), cell: statusBtn },
        { key: 'actions', header: t('rules.actions'), cell: actions },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, fmt, busy, tested]);

  const eventDescriptor = useMemo<CollectionDescriptor<AlertEvent>>(() => {
    const ack = (ev: AlertEvent) =>
      ev.status === 'triggered' ? (
        <button type="button" style={ghostBtnStyle} disabled={busy}
          onClick={() => run(() => alertsApi.ackEvent(ev.id))}>
          {t('events.acknowledge')}
        </button>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return {
      entity: null,
      surfaceKey: 'alerts.events',
      rowId: (ev) => ev.id,
      label: (ev) => ev.message,
      defaultSort: { key: 'when', dir: 'desc' },
      emptyKey: 'emptyAlertEvents',
      card: (ev) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
          <span style={{ fontWeight: 600 }}>{ev.message}</span>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            {fmt.dateTime(ev.createdAt)} · {metricLabel(ev.metric)} · {t(`eventStatus.${ev.status}`)}
          </span>
          <div>{ack(ev)}</div>
        </div>
      ),
      columns: [
        { key: 'when', header: t('events.when'), sortKey: 'when', compare: (a, b) => a.createdAt.localeCompare(b.createdAt), cell: (ev) => fmt.dateTime(ev.createdAt) },
        { key: 'metric', header: t('field.metric'), sortKey: 'metric', compare: (a, b) => (a.metric ?? '').localeCompare(b.metric ?? ''), cell: (ev) => metricLabel(ev.metric) },
        { key: 'message', header: t('events.message'), cell: (ev) => ev.message },
        { key: 'status', header: t('rules.status'), sortKey: 'status', compare: (a, b) => a.status.localeCompare(b.status), cell: (ev) => t(`eventStatus.${ev.status}`) },
        { key: 'actions', header: t('rules.actions'), cell: ack },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, fmt, busy]);

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, margin: 0 }}>{t('title')}</h1>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-secondary)', marginTop: 4 }}>{t('subtitle')}</p>
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
                <Select style={inputStyle} value={draft.metric}
                  onChange={(e) => setDraft({ ...draft, metric: e.target.value as AlertMetric })}>
                  {METRICS.map((m) => <option key={m} value={m}>{t(`metric.${m}`)}</option>)}
                </Select>
              </Field>
              <Field label={t('field.comparator')}>
                <Select style={inputStyle} value={draft.comparator}
                  onChange={(e) => setDraft({ ...draft, comparator: e.target.value as AlertComparator })}>
                  {COMPARATORS.map((c) => <option key={c} value={c}>{t(`comparator.${c}`)}</option>)}
                </Select>
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
                <Select style={inputStyle} value={draft.scopeKind}
                  onChange={(e) => setDraft({ ...draft, scopeKind: e.target.value as AlertScopeKind })}>
                  {SCOPES.map((s) => <option key={s} value={s}>{t(`scope.${s}`)}</option>)}
                </Select>
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
              : <LocalCollection descriptor={ruleDescriptor} rows={rules.data.alerts} searchText={(a) => a.name} />}
          </PmCard>

          {/* Recent events */}
          <PmCard title={t('events.title')}>
            {events.error ? <PmError message={events.error} />
              : !events.data ? <PmEmpty message={t('loading')} />
              : <LocalCollection descriptor={eventDescriptor} rows={events.data.events} searchText={(ev) => ev.message} />}
          </PmCard>
        </div>
      </RoleGate>
    </PageContainer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
      {label}
      {children}
    </label>
  );
}

const checkLabel: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)',
};

