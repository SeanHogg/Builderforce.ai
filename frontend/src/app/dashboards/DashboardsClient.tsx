'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { DashboardWidget } from '@/components/dashboard';
import { WidgetCard } from '@/components/widgets/WidgetCard';
import { getWidget, listWidgetGroups } from '@/lib/widgets/registry';
import {
  dashboardsApi,
  type DashboardData,
  type MetricCatalogEntry,
  type QueryAnswer,
  type SavedDashboard,
  type WidgetViz,
} from '@/lib/dashboardsApi';

const VIZ_OPTIONS: WidgetViz[] = ['stat', 'bar', 'line', 'gauge'];

export default function DashboardsClient() {
  const t = useTranslations('dashboards');
  const tw = useTranslations('widgets');

  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [metrics, setMetrics] = useState<MetricCatalogEntry[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-dashboard + add-widget form state.
  const [newName, setNewName] = useState('');
  const [pickMetric, setPickMetric] = useState('');
  const [pickViz, setPickViz] = useState<WidgetViz>('stat');
  const [pickWidget, setPickWidget] = useState('');
  const widgetGroups = useMemo(() => listWidgetGroups(), []);

  // Ask box state.
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  const active = useMemo(() => dashboards.find((d) => d.id === activeId) ?? null, [dashboards, activeId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, cat] = await Promise.all([dashboardsApi.list(), dashboardsApi.metrics()]);
      setDashboards(list.dashboards);
      setMetrics(cat.metrics);
      if (cat.metrics.length && !pickMetric) setPickMetric(cat.metrics[0].key);
      setActiveId((prev) => prev ?? list.dashboards[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [pickMetric]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Load resolved widget values whenever the active dashboard or its widgets change.
  const loadData = useCallback(async (id: number) => {
    try {
      setData(await dashboardsApi.data(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (activeId != null) void loadData(activeId);
    else setData(null);
  }, [activeId, loadData, active?.widgets.length]);

  const createDashboard = async () => {
    if (!newName.trim()) return;
    try {
      const d = await dashboardsApi.create(newName.trim());
      setNewName('');
      await reload();
      setActiveId(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteDashboard = async (id: number) => {
    try {
      await dashboardsApi.remove(id);
      if (activeId === id) setActiveId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addWidget = async () => {
    if (activeId == null || !pickMetric) return;
    try {
      await dashboardsApi.addWidget(activeId, { metricKey: pickMetric, viz: pickViz });
      await reload();
      await loadData(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addRegistryWidget = async () => {
    if (activeId == null || !pickWidget) return;
    try {
      await dashboardsApi.addWidget(activeId, { widgetKey: pickWidget });
      await reload();
      await loadData(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeWidget = async (widgetId: number) => {
    if (activeId == null) return;
    try {
      await dashboardsApi.removeWidget(activeId, widgetId);
      await reload();
      await loadData(activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await dashboardsApi.query(question.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
  };
  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontWeight: 600,
  };

  return (
    <PageContainer width="readable">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('title')}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>{t('subtitle')}</p>

      {error && (
        <div style={{ color: 'var(--danger, #d33)', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {/* ── Ask box (AI-powered query) ────────────────────────────────────── */}
      <section style={{ marginBottom: 28, padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{t('ask.heading')}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ ...inputStyle, flex: '1 1 320px' }}
            placeholder={t('ask.placeholder')}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
          />
          <button style={btnStyle} onClick={() => void ask()} disabled={asking}>
            {asking ? t('ask.asking') : t('ask.button')}
          </button>
        </div>
        {answer && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-elevated)' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {answer.value == null
                ? '—'
                : answer.unit === 'USD'
                  ? `$${Math.round(answer.value).toLocaleString('en-US')}`
                  : answer.unit === '%'
                    ? `${Math.round(answer.value * 100) / 100}%`
                    : `${Math.round(answer.value * 100) / 100}${answer.unit === '/day' ? '/day' : answer.unit === 'hours' ? 'h' : ''}`}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{answer.explanation}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {t('ask.matched')}: <code>{answer.matchedMetric}</code>
            </div>
          </div>
        )}
      </section>

      {/* ── Dashboards ────────────────────────────────────────────────────── */}
      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {dashboards.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveId(d.id)}
              style={{
                ...btnStyle,
                background: d.id === activeId ? 'var(--accent, #4060ff)' : 'var(--bg-elevated)',
                color: d.id === activeId ? '#fff' : 'var(--text-primary)',
              }}
            >
              {d.name}
            </button>
          ))}
          {loading && <span style={{ color: 'var(--text-secondary)' }}>…</span>}
        </div>

        <RoleGate capability="dashboards.manage" variant="block">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <input
              style={inputStyle}
              placeholder={t('create.placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button style={btnStyle} onClick={() => void createDashboard()}>{t('create.button')}</button>
            {active && (
              <button style={{ ...btnStyle, color: 'var(--danger, #d33)' }} onClick={() => void deleteDashboard(active.id)}>
                {t('delete.button')}
              </button>
            )}
          </div>
        </RoleGate>
      </section>

      {/* ── Active dashboard ──────────────────────────────────────────────── */}
      {!active && !loading && (
        <p style={{ color: 'var(--text-secondary)' }}>{t('empty')}</p>
      )}

      {active && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{active.name}</h2>

          <RoleGate capability="dashboards.manage" variant="block">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
              <select style={inputStyle} value={pickMetric} onChange={(e) => setPickMetric(e.target.value)}>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>{m.label} ({m.unit || 'count'})</option>
                ))}
              </select>
              <select style={inputStyle} value={pickViz} onChange={(e) => setPickViz(e.target.value as WidgetViz)}>
                {VIZ_OPTIONS.filter((v) => v !== 'widget').map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button style={btnStyle} onClick={() => void addWidget()}>{t('widget.add')}</button>
            </div>
            {/* Rich insight widgets from the app-wide registry (charts, not just scalars). */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
              <select style={inputStyle} value={pickWidget} onChange={(e) => setPickWidget(e.target.value)}>
                <option value="">{tw('addTitle')}…</option>
                {widgetGroups.map((g) => (
                  <optgroup key={g.group} label={tw(`group.${g.group}`)}>
                    {g.widgets.map((w) => (
                      <option key={w.id} value={w.id}>{tw(`title.${w.titleKey}`)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button style={btnStyle} onClick={() => void addRegistryWidget()} disabled={!pickWidget}>{tw('addToDashboard')}</button>
            </div>
          </RoleGate>

          {data && data.widgets.length === 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>{t('widget.empty')}</p>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {data?.widgets.map((w) => {
              const def = w.widgetKey ? getWidget(w.widgetKey) : undefined;
              return (
              <div key={w.widgetId} style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
                {def ? <WidgetCard def={def} days={w.days} /> : <DashboardWidget v={w} />}
                <RoleGate capability="dashboards.manage">
                  <button
                    onClick={() => void removeWidget(w.widgetId)}
                    title={t('widget.remove')}
                    style={{
                      position: 'absolute', top: 6, right: 6,
                      border: 'none', background: 'transparent', cursor: 'pointer',
                      color: 'var(--text-secondary)', fontSize: 14,
                    }}
                  >
                    ✕
                  </button>
                </RoleGate>
              </div>
              );
            })}
          </div>
        </section>
      )}
    </PageContainer>
  );
}
