'use client';

/**
 * /insights — THE dashboard. Standard, out-of-box, and the only dashboard surface
 * (there is no separate "Dashboards" tab — this absorbed it).
 *
 * It unifies the two things that used to be split across a Home idea and a
 * "Custom Dashboards" page:
 *   • "My Dashboard" — the widgets YOU pinned from anywhere in the app (personal,
 *     drag-reorderable).
 *   • Named, tenant-SHARED dashboards — manager-built layouts of the same widgets
 *     (rich registry cards) and scalar metrics.
 * Every Insights tab (AI, Delivery, Finance…) is likewise just a dashboard of
 * widgets whose cards can be pinned back here. Pin a card → it shows up here.
 *
 * ── A standard page, not a canvas ────────────────────────────────────────────
 * This was a `WorkspaceCanvas`: pinned widgets were laid out by computing x/y
 * from the pin's index, so the page ignored each widget's size hint, could not
 * reflow, and — the real cost — the drag-to-REORDER that pins are stored with had
 * no UI, because a floating panel's position is not an order. It is now the same
 * chrome every other insights page uses ({@link LensPage}) over the shared
 * {@link ReorderableWidgetGrid}, so widgets read identically here, inside a lens,
 * and on a custom canvas — and dragging one actually persists its position.
 */

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import { RoleGate } from '@/components/RoleGate';
import { Select } from '@/components/Select';
import { LensPage, DaysWindowSelect } from '@/components/insights/LensShell';
import { WidgetCard } from '@/components/widgets/WidgetCard';
import { WidgetGrid } from '@/components/widgets/WidgetGrid';
import { ReorderableWidgetGrid } from '@/components/widgets/ReorderableWidgetGrid';
import { ComponentPicker } from '@/components/component-picker/ComponentPicker';
import { ComponentPinAction } from '@/components/widgets/ComponentPinAction';
import { PmEmpty, PmError } from '@/components/pm/pmShared';
import { usePins } from '@/lib/widgets/PinsProvider';
import { getComponent } from '@/lib/components/registry';
import { useComponentCatalog, useComponentLabel } from '@/lib/components/useComponentCatalog';
import type { ComponentSize } from '@/lib/components/types';
import { DashboardWidget } from '@/components/dashboard';
import {
  dashboardsApi,
  type DashboardData,
  type MetricCatalogEntry,
  type SavedDashboard,
  type WidgetViz,
} from '@/lib/dashboardsApi';

const VIZ_OPTIONS: WidgetViz[] = ['stat', 'bar', 'line', 'gauge'];

/** The Ask-a-question card is a registered widget; the home page always shows it. */
const ASK_IDS = ['overview.ask'];

/** Same span rule as WidgetGrid, so a saved dashboard lays out like every other. */
const SPAN: Record<ComponentSize, React.CSSProperties> = {
  sm: {},
  md: { gridColumn: 'span 2' },
  lg: { gridColumn: '1 / -1' },
};

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, alignItems: 'stretch',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', minWidth: 0,
};
const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer',
  fontWeight: 600, fontSize: 'var(--font-size-small)', whiteSpace: 'nowrap',
};
const primaryBtn: React.CSSProperties = {
  ...btnStyle, background: 'var(--coral-bright)', color: 'var(--text-on-accent)', border: '1px solid transparent',
};

/** 'me' = the personal pinned view; a number = a saved tenant-shared dashboard id. */
type View = 'me' | number;

export default function InsightsHomePage() {
  const t = useTranslations('insights');
  const td = useTranslations('dashboards');
  const tw = useTranslations('components');
  const label = useComponentLabel();
  // LensPage owns the redirect for a signed-out / tenantless visitor; this page
  // still reads the session so its own dashboard reads never fire before there
  // is a tenant to scope them to (they would 401).
  // The ONE derivation of "is there a real workspace behind this screen",
  // shared with the sample-data notice and every `<SessionGate>`. Written out
  // here it was a second copy, and a second copy is how a page ends up reading
  // real rows while the banner above it says the data is sample.
  const { signedIn } = useSampleWorkspace();
  const { pinned, loading: pinsLoading } = usePins();

  const [days, setDays] = useState(30);
  const [picker, setPicker] = useState(false);
  const [view, setView] = useState<View>('me');

  const [dashboards, setDashboards] = useState<SavedDashboard[]>([]);
  const [metrics, setMetrics] = useState<MetricCatalogEntry[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [pickMetric, setPickMetric] = useState('');
  const [pickViz, setPickViz] = useState<WidgetViz>('stat');
  const [pickWidget, setPickWidget] = useState('');
  // The SAME catalogue the picker panel browses — grouped, labelled and
  // mount-filtered once. An unfiltered query means "everything at this mount";
  // the select has no search box of its own.
  const widgetGroups = useComponentCatalog('dashboard', '');

  const active = useMemo(
    () => (typeof view === 'number' ? dashboards.find((d) => d.id === view) ?? null : null),
    [dashboards, view],
  );

  const reload = useCallback(async () => {
    // No `signedIn` guard any more, and its absence is the point. The guard was
    // there so a tenantless visitor did not fire reads that 401; the transport
    // now answers a guest's GET from the sample workspace, so guarding it is
    // what would leave this page — the product's headline surface — empty for
    // exactly the person it most needs to convince.
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

  useEffect(() => { void reload(); }, [reload]);

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
  /**
   * Materialise the curated Executive dashboard.
   *
   * The alternative this replaces was: create a dashboard, then pick eight cards
   * out of a registry of well over a hundred, one at a time, already knowing which
   * eight. Idempotent on the server, so a double-click costs nothing and a manager
   * who runs it again next month gets their tiles back rather than a duplicate set
   * — which is why the button needs no disabled-after-success state, only a
   * disabled-while-in-flight one.
   */
  const seedExecutive = async () => {
    setSeeding(true);
    try {
      const { dashboardId } = await dashboardsApi.applyPreset('executive');
      await reload();
      setView(dashboardId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSeeding(false); }
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

  const tabStyle = (on: boolean): React.CSSProperties => ({
    ...btnStyle,
    background: on ? 'var(--coral-bright)' : 'var(--bg-elevated)',
    color: on ? 'var(--text-on-accent)' : 'var(--text-primary)',
    border: `1px solid ${on ? 'transparent' : 'var(--border-subtle)'}`,
  });

  return (
    <LensPage
      titleKey="home.title"
      subtitleKey="home.subtitle"
      actions={
        <>
          <DaysWindowSelect value={days} onChange={setDays} />
          {view === 'me' && (
            <button type="button" style={primaryBtn} onClick={() => setPicker(true)}>
              <Icon source="＋" size="1em" /> {t('home.addWidgets')}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {error && <PmError message={error} />}

        {/* Dashboard switcher: your pins, then every shared dashboard. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={tabStyle(view === 'me')} onClick={() => setView('me')}>
            <Icon source="📌" size="1em" /> {t('home.myDashboard')}
          </button>
          {dashboards.map((d) => (
            <button key={d.id} type="button" style={tabStyle(view === d.id)} onClick={() => setView(d.id)}>{d.name}</button>
          ))}
          <RoleGate capability="dashboards.manage">
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={inputStyle}
                placeholder={td('create.placeholder')}
                aria-label={td('create.placeholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="button" style={btnStyle} onClick={() => void createDashboard()}>{td('create.button')}</button>
              {/* The curated starting point, beside the blank one. Shown whether or
                  not it already exists: re-applying repairs a dashboard somebody
                  pruned, and the server refuses to duplicate it. */}
              <button type="button" style={btnStyle} onClick={() => void seedExecutive()} disabled={seeding} title={td('presets.executiveHint')}>
                {seeding ? td('presets.creating') : td('presets.executive')}
              </button>
            </span>
          </RoleGate>
        </div>

        {/* Plain-English metric query — a registered widget like everything else. */}
        <WidgetGrid ids={ASK_IDS} days={days} />

        {view === 'me' && (
          pinned.length === 0 ? (
            <div style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)', padding: 32, textAlign: 'center',
            }}>
              {pinsLoading ? (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-body)' }}>{t('loading')}</p>
              ) : (
                <>
                  <h3 style={{ margin: '0 0 8px', fontSize: 'var(--font-size-card-title)', fontWeight: 700 }}>{t('home.emptyTitle')}</h3>
                  <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 'var(--font-size-body)' }}>{t('home.emptyBody')}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button type="button" style={primaryBtn} onClick={() => setPicker(true)}>
                      <Icon source="＋" size="1em" /> {t('home.addWidgets')}
                    </button>
                    {/* An empty page that only offers "go pick some widgets" asks the
                        newcomer the one question they cannot yet answer. The curated
                        dashboard is the answer, one click away. */}
                    <RoleGate capability="dashboards.manage">
                      <button type="button" style={btnStyle} onClick={() => void seedExecutive()} disabled={seeding}>
                        {seeding ? td('presets.creating') : td('presets.executive')}
                      </button>
                    </RoleGate>
                  </div>
                </>
              )}
            </div>
          ) : (
            <ReorderableWidgetGrid ids={pinned} days={days} />
          )
        )}

        {active && (
          <>
            <RoleGate capability="dashboards.manage" variant="block">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Select style={inputStyle} value={pickWidget} onChange={(e) => setPickWidget(e.target.value)} aria-label={tw('addTitle')}>
                  <option value="">{tw('addTitle')}…</option>
                  {widgetGroups.map((g) => (
                    <optgroup key={g.group} label={g.groupLabel}>
                      {g.components.map((w) => <option key={w.id} value={w.id}>{label(w)}</option>)}
                    </optgroup>
                  ))}
                </Select>
                <button type="button" style={btnStyle} onClick={() => void addRegistryWidget()} disabled={!pickWidget}>{tw('addToDashboard')}</button>
                <Select style={inputStyle} value={pickMetric} onChange={(e) => setPickMetric(e.target.value)} aria-label={td('widget.add')}>
                  {metrics.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit || 'count'})</option>)}
                </Select>
                <Select style={inputStyle} value={pickViz} onChange={(e) => setPickViz(e.target.value as WidgetViz)} aria-label={td('widget.add')}>
                  {VIZ_OPTIONS.map((v) => <option key={v} value={v}>{td(`viz.${v}`)}</option>)}
                </Select>
                <button type="button" style={btnStyle} onClick={() => void addMetricWidget()}>{td('widget.add')}</button>
                <button
                  type="button"
                  style={{ ...btnStyle, marginLeft: 'auto', color: 'var(--danger)' }}
                  onClick={() => void deleteDashboard(active.id)}
                >{td('delete.button')}</button>
              </div>
            </RoleGate>

            {data && data.widgets.length === 0 ? (
              <PmEmpty message={td('widget.empty')} />
            ) : (
              <div style={gridStyle}>
                {data?.widgets.map((w) => {
                  const def = w.widgetKey ? getComponent(w.widgetKey) : undefined;
                  return (
                    <div key={w.widgetId} style={{ ...SPAN[def?.size ?? 'sm'], position: 'relative' }}>
                      {def ? <WidgetCard def={def} days={w.days} /> : <DashboardWidget v={w} />}
                      <RoleGate capability="dashboards.manage">
                        <button
                          type="button"
                          onClick={() => void removeWidget(w.widgetId)}
                          title={td('widget.remove')}
                          aria-label={td('widget.remove')}
                          style={{
                            position: 'absolute', top: 6, right: 6, border: 'none', background: 'transparent',
                            cursor: 'pointer', color: 'var(--text-secondary)',
                          }}
                        ><Icon source="✕" size="1em" /></button>
                      </RoleGate>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* The dashboard's errand in the shared catalogue: pin one to my home. The
          picker knows nothing about pins — the action does, and gates itself. */}
      <ComponentPicker
        open={picker}
        onClose={() => setPicker(false)}
        mount="dashboard"
        title={`✛ ${tw('addTitle')}`}
        action={(def) => <ComponentPinAction def={def} />}
      />
    </LensPage>
  );
}
