'use client';

/**
 * /insights — THE dashboard. Standard, out-of-box, and the only dashboard surface
 * (there is no separate "Dashboards" tab — this absorbed it).
 *
 * It unifies the two things that used to be split across a Home idea and a
 * "Custom Dashboards" page:
 *   • "My Dashboard" — the widgets YOU pinned from anywhere in the app (personal).
 *   • Named, tenant-SHARED dashboards — manager-built layouts of the same widgets
 *     (rich registry cards) and scalar metrics, plus the plain-English "Ask".
 * Every Insights tab (AI, Delivery, Finance…) is likewise just a dashboard of
 * widgets whose cards can be pinned back here. Pin a card → it shows up here.
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import PageContainer from '@/components/PageContainer';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { DaysWindowSelect } from '@/components/insights/LensShell';
import { WidgetCard } from '@/components/widgets/WidgetCard';
import { AddWidgetPicker } from '@/components/widgets/AddWidgetPicker';
import { WorkspaceCanvas, type WorkspaceCanvasPanel } from '@/components/workspace-canvas/WorkspaceCanvas';
import { usePins } from '@/lib/widgets/PinsProvider';
import { getWidget, listWidgetGroups } from '@/lib/widgets/registry';
import { DashboardWidget } from '@/components/dashboard';
import {
  dashboardsApi,
  type DashboardData,
  type MetricCatalogEntry,
  type QueryAnswer,
  type SavedDashboard,
  type WidgetViz,
} from '@/lib/dashboardsApi';

const VIZ_OPTIONS: WidgetViz[] = ['stat', 'bar', 'line', 'gauge'];

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)',
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
};
const primaryBtn: React.CSSProperties = { ...btnStyle, background: 'var(--coral-bright)', color: 'var(--text-on-accent)', border: '1px solid transparent' };

/** 'me' = the personal pinned view; a number = a saved tenant-shared dashboard id. */
type View = 'me' | number;

export default function InsightsHomePage() {
  const t = useTranslations('insights');
  const td = useTranslations('dashboards');
  const tw = useTranslations('widgets');
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  const { pinned, loading: pinsLoading } = usePins();

  const [days, setDays] = useState(30);
  const [picker, setPicker] = useState(false);
  const [view, setView] = useState<View>('me');

  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [metrics, setMetrics] = useState<MetricCatalogEntry[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [pickMetric, setPickMetric] = useState('');
  const [pickViz, setPickViz] = useState<WidgetViz>('stat');
  const [pickWidget, setPickWidget] = useState('');
  const widgetGroups = useMemo(() => listWidgetGroups(), []);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  const active = useMemo(() => (typeof view === 'number' ? dashboards.find((d) => d.id === view) ?? null : null), [dashboards, view]);

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
    else if (!hasTenant) router.replace('/tenants');
  }, [isAuthenticated, hasTenant, router]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [list, cat] = await Promise.all([dashboardsApi.list(), dashboardsApi.metrics()]);
      setDashboards(list.dashboards);
      setMetrics(cat.metrics);
      if (cat.metrics.length && !pickMetric) setPickMetric(cat.metrics[0].key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pickMetric]);

  useEffect(() => { if (isAuthenticated && hasTenant) void reload(); }, [isAuthenticated, hasTenant, reload]);

  const loadData = useCallback(async (id: number) => {
    try { setData(await dashboardsApi.data(id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    if (typeof view === 'number') void loadData(view);
    else setData(null);
  }, [view, loadData, active?.widgets.length]);

  // ── Saved-dashboard mutations (manager) ──────────────────────────────────────
  const createDashboard = async () => {
    if (!newName.trim()) return;
    try {
      const d = await dashboardsApi.create(newName.trim());
      setNewName('');
      await reload();
      setView(d.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const deleteDashboard = async (id: number) => {
    try { await dashboardsApi.remove(id); setView('me'); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const addMetricWidget = async () => {
    if (typeof view !== 'number' || !pickMetric) return;
    try { await dashboardsApi.addWidget(view, { metricKey: pickMetric, viz: pickViz }); await reload(); await loadData(view); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const addRegistryWidget = async () => {
    if (typeof view !== 'number' || !pickWidget) return;
    try { await dashboardsApi.addWidget(view, { widgetKey: pickWidget }); await reload(); await loadData(view); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const removeWidget = async (widgetId: number) => {
    if (typeof view !== 'number') return;
    try { await dashboardsApi.removeWidget(view, widgetId); await reload(); await loadData(view); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true); setAnswer(null);
    try { setAnswer(await dashboardsApi.query(question.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAsking(false); }
  };

  if (!isAuthenticated || !hasTenant) return null;

  const tabStyle = (on: boolean): React.CSSProperties => ({
    ...btnStyle, background: on ? 'var(--coral-bright)' : 'var(--bg-elevated)', color: on ? 'var(--text-on-accent)' : 'var(--text-primary)',
    border: `1px solid ${on ? 'transparent' : 'var(--border-subtle)'}`,
  });

  const panels: WorkspaceCanvasPanel[] = [
    {
      id: 'insights-dashboard-controls', title: t('home.title'), subtitle: t('home.subtitle'), icon: '📌',
      position: { x: 36, y: 36 }, width: 1300, height: 180,
      content: <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={tabStyle(view === 'me')} onClick={() => setView('me')}><Icon source="📌" size="1em" /> {t('home.myDashboard')}</button>
          {dashboards.map((d) => <button key={d.id} type="button" style={tabStyle(view === d.id)} onClick={() => setView(d.id)}>{d.name}</button>)}
          <RoleGate capability="dashboards.manage">
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <input style={inputStyle} placeholder={td('create.placeholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="button" style={btnStyle} onClick={() => void createDashboard()}>{td('create.button')}</button>
            </span>
          </RoleGate>
        </div>
      </div>,
    },
    {
      id: 'insights-ask', title: td('ask.heading'), subtitle: 'Plain-English metric query', icon: '?',
      position: { x: 36, y: 240 }, width: 1300, height: answer ? 240 : 150,
      content: <div data-tour="demo-insights">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input style={{ ...inputStyle, flex: '1 1 320px' }} placeholder={td('ask.placeholder')} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} />
          <button style={btnStyle} onClick={() => void ask()} disabled={asking}>{asking ? td('ask.asking') : td('ask.button')}</button>
        </div>
        {answer && <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{answer.value == null ? '—' : answer.unit === 'USD' ? `$${Math.round(answer.value).toLocaleString('en-US')}` : answer.unit === '%' ? `${Math.round(answer.value * 100) / 100}%` : `${Math.round(answer.value * 100) / 100}${answer.unit === '/day' ? '/day' : answer.unit === 'hours' ? 'h' : ''}`}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{answer.explanation}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{td('ask.matched')}: <code>{answer.matchedMetric}</code></div>
        </div>}
      </div>,
    },
  ];

  if (view === 'me') {
    const definitions = pinned.map(getWidget).filter((def): def is NonNullable<typeof def> => Boolean(def));
    if (definitions.length === 0) {
      panels.push({
        id: 'insights-empty', title: t('home.myDashboard'), icon: '📌', position: { x: 36, y: 420 }, width: 620, height: 260,
        content: <div style={{ padding: 28, textAlign: 'center' }}><h3 style={{ margin: '0 0 8px' }}>{t('home.emptyTitle')}</h3><p style={{ color: 'var(--text-secondary)' }}>{t('home.emptyBody')}</p>{!pinsLoading && <button type="button" style={primaryBtn} onClick={() => setPicker(true)}><Icon source="＋" size="1em" /> {t('home.addWidgets')}</button>}</div>,
      });
    } else {
      definitions.forEach((def, index) => {
        const wide = def.size === 'lg';
        const medium = def.size === 'md';
        const width = wide ? 1300 : medium ? 820 : 400;
        const column = index % 3;
        const row = Math.floor(index / 3);
        panels.push({
          id: `insights-widget:${def.id}`, title: tw(`title.${def.titleKey}`), subtitle: tw(`group.${def.group}`), icon: '◇',
          position: { x: 36 + column * 432, y: 420 + row * 390 }, width, height: wide ? 430 : 350,
          content: <WidgetCard def={def} days={days} />,
        });
      });
    }
  }

  if (active) {
    panels.push({
      id: `insights-dashboard-builder:${active.id}`, title: active.name, subtitle: 'Dashboard modules', icon: '▦',
      position: { x: 36, y: 420 }, width: 1300, height: 150,
      content: <RoleGate capability="dashboards.manage" variant="block"><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select style={inputStyle} value={pickWidget} onChange={(e) => setPickWidget(e.target.value)}><option value="">{tw('addTitle')}…</option>{widgetGroups.map((g) => <optgroup key={g.group} label={tw(`group.${g.group}`)}>{g.widgets.map((w) => <option key={w.id} value={w.id}>{tw(`title.${w.titleKey}`)}</option>)}</optgroup>)}</Select>
        <button style={btnStyle} onClick={() => void addRegistryWidget()} disabled={!pickWidget}>{tw('addToDashboard')}</button>
        <Select style={inputStyle} value={pickMetric} onChange={(e) => setPickMetric(e.target.value)}>{metrics.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit || 'count'})</option>)}</Select>
        <Select style={inputStyle} value={pickViz} onChange={(e) => setPickViz(e.target.value as WidgetViz)}>{VIZ_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}</Select>
        <button style={btnStyle} onClick={() => void addMetricWidget()}>{td('widget.add')}</button>
        <button style={{ ...btnStyle, marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => void deleteDashboard(active.id)}>{td('delete.button')}</button>
      </div></RoleGate>,
    });
    data?.widgets.forEach((w, index) => {
      const def = w.widgetKey ? getWidget(w.widgetKey) : undefined;
      panels.push({
        id: `insights-dashboard-widget:${w.widgetId}`, title: def ? tw(`title.${def.titleKey}`) : (w.title ?? w.label), subtitle: active.name, icon: '◇',
        position: { x: 36 + (index % 3) * 432, y: 600 + Math.floor(index / 3) * 390 }, width: def?.size === 'md' ? 820 : def?.size === 'lg' ? 1300 : 400, height: def?.size === 'lg' ? 430 : 350,
        content: <div style={{ position: 'relative', height: '100%' }}>{def ? <WidgetCard def={def} days={w.days} /> : <DashboardWidget v={w} />}<RoleGate capability="dashboards.manage"><button onClick={() => void removeWidget(w.widgetId)} title={td('widget.remove')} style={{ position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}><Icon source="✕" size="1em" /></button></RoleGate></div>,
      });
    });
    if (data && data.widgets.length === 0) panels.push({ id: `insights-dashboard-empty:${active.id}`, title: active.name, icon: '◇', position: { x: 36, y: 600 }, width: 500, height: 180, content: <p style={{ color: 'var(--text-secondary)' }}>{td('widget.empty')}</p> });
  }

  return <PageContainer style={{ padding: 0 }}>
    <WorkspaceCanvas panels={panels} toolbar={<><DaysWindowSelect value={days} onChange={setDays} />{view === 'me' && <button type="button" style={primaryBtn} onClick={() => setPicker(true)}><Icon source="＋" size="1em" /> {t('home.addWidgets')}</button>}</>} />
    <AddWidgetPicker open={picker} onClose={() => setPicker(false)} />
  </PageContainer>;
}
