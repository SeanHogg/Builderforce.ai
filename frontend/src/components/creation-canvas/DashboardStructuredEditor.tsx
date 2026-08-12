import { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import { useDragReorder } from '@/lib/useDragReorder';
import {
  DASHBOARD_CHART_DEFINITIONS,
  DASHBOARD_MAX_WIDGETS,
  createDashboardWidget,
  dashboardChartDefinition,
  parseLabelList,
  parseValueList,
  type DashboardChartKind,
  type DashboardSeries,
  type DashboardWidget,
  type DashboardWidgetSpan,
} from '@/lib/canvasDashboard';

/**
 * The dashboard's WYSIWYG editor.
 *
 * Pure and canvas-unaware, exactly like {@link ResumeStructuredEditor}: it is handed
 * the widget list and a whole-list `onChange`, and knows nothing about nodes, patches
 * or React Flow. Every mutation is an immutable replace — no local draft state, no
 * debounce, no dirty flag — so the card beside it redraws from the same array as the
 * author types, which is what makes the surface WYSIWYG rather than a form.
 */

const SPANS: readonly DashboardWidgetSpan[] = ['half', 'full'];

export function DashboardStructuredEditor({
  widgets,
  onChange,
}: {
  widgets: readonly DashboardWidget[];
  onChange: (widgets: DashboardWidget[]) => void;
}) {
  const t = useTranslations('creationCanvas.dashboardEditor');
  // Chart names and span names are looked up by their value, so the key is dynamic.
  const translate = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const [deleted, setDeleted] = useState<{ index: number; widget: DashboardWidget } | null>(null);

  const order = widgets.map((widget) => widget.id);
  const reorder = (next: string[]) => onChange(next
    .map((id) => widgets.find((widget) => widget.id === id))
    .filter((widget): widget is DashboardWidget => widget != null));
  const drag = useDragReorder(order, reorder);

  const replace = (index: number, widget: DashboardWidget) => onChange(widgets.map((current, i) => i === index ? widget : current));
  const remove = (index: number) => {
    const widget = widgets[index];
    if (widget) setDeleted({ index, widget });
    onChange(widgets.filter((_, i) => i !== index));
  };
  const undoDelete = () => {
    if (!deleted) return;
    const next = [...widgets];
    next.splice(Math.min(deleted.index, next.length), 0, deleted.widget);
    onChange(next);
    setDeleted(null);
  };
  const add = (chart: DashboardChartKind) => {
    if (widgets.length >= DASHBOARD_MAX_WIDGETS) return;
    const id = crypto.randomUUID();
    onChange([...widgets, createDashboardWidget(chart, {
      id,
      title: translate(`chart.${chart}`),
      categories: [t('categoryA'), t('categoryB'), t('categoryC'), t('categoryD')],
      seriesName: t('defaultSeriesName'),
    })]);
  };

  /**
   * Changing the chart kind KEEPS the data. The categories and numbers an author
   * typed are the work; the mark drawn over them is a presentation choice, and losing
   * the former when changing the latter is the thing that makes people stop trying
   * chart types.
   */
  const setChart = (index: number, widget: DashboardWidget, chart: DashboardChartKind) => {
    const definition = dashboardChartDefinition(chart);
    replace(index, {
      ...widget,
      chart,
      span: definition.span,
      series: definition.series === 'single' ? widget.series.slice(0, 1) : widget.series,
      target: definition.target ? widget.target ?? 100 : widget.target,
    });
  };

  const setSeries = (index: number, widget: DashboardWidget, seriesIndex: number, series: DashboardSeries) =>
    replace(index, { ...widget, series: widget.series.map((current, i) => i === seriesIndex ? series : current) });

  const addSeries = (index: number, widget: DashboardWidget) => replace(index, {
    ...widget,
    series: [...widget.series, { id: crypto.randomUUID(), name: t('seriesIndex', { index: widget.series.length + 1 }), values: [] }],
  });

  const removeSeries = (index: number, widget: DashboardWidget, seriesIndex: number) =>
    replace(index, { ...widget, series: widget.series.filter((_, i) => i !== seriesIndex) });

  return (
    <div className={styles.dashboardEditor}>
      {deleted && (
        <div className={styles.resumeUndoDelete} role="status">
          <span>{t('widgetDeleted')}</span>
          <button type="button" onClick={undoDelete}>{t('undoDelete')}</button>
          <button type="button" aria-label={t('dismissUndo')} onClick={() => setDeleted(null)}>×</button>
        </div>
      )}

      {widgets.map((widget, index) => {
        const definition = dashboardChartDefinition(widget.chart);
        const name = widget.title || translate(`chart.${widget.chart}`);
        return (
          <fieldset
            key={widget.id}
            className={styles.dashboardWidgetRow}
            {...drag.dropTargetProps(widget.id)}
            data-dragging={drag.draggingKey === widget.id || undefined}
            data-drop-target={drag.dropKey === widget.id || undefined}
          >
            <legend>{name}</legend>
            <div className={styles.resumeEntryActions}>
              <button type="button" className={styles.resumeSectionDragHandle} aria-label={t('dragWidget', { name })} {...drag.dragHandleProps(widget.id)}>⠿</button>
              <button type="button" disabled={index === 0} aria-label={t('moveUp')} onClick={() => drag.nudge(widget.id, -1)}>↑</button>
              <button type="button" disabled={index === widgets.length - 1} aria-label={t('moveDown')} onClick={() => drag.nudge(widget.id, 1)}>↓</button>
              <button type="button" aria-label={t('removeWidget', { name })} onClick={() => remove(index)}>×</button>
            </div>

            <div className={styles.resumeFieldGrid}>
              <label>
                <span>{t('chartType')}</span>
                <select value={widget.chart} onChange={(event) => setChart(index, widget, event.target.value as DashboardChartKind)}>
                  {DASHBOARD_CHART_DEFINITIONS.map((option) => (
                    <option key={option.chart} value={option.chart}>{`${option.glyph}  ${translate(`chart.${option.chart}`)}`}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('widgetTitle')}</span>
                <input value={widget.title} onChange={(event) => replace(index, { ...widget, title: event.target.value })} />
              </label>
              <label>
                <span>{t('width')}</span>
                <select value={widget.span} onChange={(event) => replace(index, { ...widget, span: event.target.value as DashboardWidgetSpan })}>
                  {SPANS.map((span) => <option key={span} value={span}>{translate(`span.${span}`)}</option>)}
                </select>
              </label>

              {definition.metric && (
                <>
                  <label>
                    <span>{t('metricValue')}</span>
                    <input value={widget.value} onChange={(event) => replace(index, { ...widget, value: event.target.value })} placeholder={t('metricValuePlaceholder')} />
                  </label>
                  <label>
                    <span>{t('metricTrend')}</span>
                    <input value={widget.trend} onChange={(event) => replace(index, { ...widget, trend: event.target.value })} placeholder={t('metricTrendPlaceholder')} />
                  </label>
                </>
              )}

              {definition.target && (
                <>
                  <label>
                    <span>{t('target')}</span>
                    <input
                      inputMode="decimal"
                      value={widget.target == null ? '' : String(widget.target)}
                      onChange={(event) => replace(index, { ...widget, target: parseValueList(event.target.value)[0] ?? null })}
                    />
                  </label>
                  <label>
                    <span>{t('unit')}</span>
                    <input value={widget.unit} onChange={(event) => replace(index, { ...widget, unit: event.target.value })} placeholder={t('unitPlaceholder')} />
                  </label>
                </>
              )}

              {definition.categories && (
                <label className={styles.resumeFieldWide}>
                  <span>{t('categories')}</span>
                  <textarea
                    value={widget.labels.join('\n')}
                    onChange={(event) => replace(index, { ...widget, labels: parseLabelList(event.target.value) })}
                    placeholder={t('categoriesPlaceholder')}
                  />
                </label>
              )}

              {definition.series !== 'none' && widget.series.map((series, seriesIndex) => (
                <div key={series.id} className={styles.dashboardSeriesRow}>
                  {definition.series === 'multi' && (
                    <label>
                      <span>{t('seriesName')}</span>
                      <input value={series.name} onChange={(event) => setSeries(index, widget, seriesIndex, { ...series, name: event.target.value })} />
                    </label>
                  )}
                  <label>
                    <span>{definition.target ? t('currentValue') : t('values')}</span>
                    <textarea
                      value={series.values.join('\n')}
                      onChange={(event) => setSeries(index, widget, seriesIndex, { ...series, values: parseValueList(event.target.value) })}
                      placeholder={t('valuesPlaceholder')}
                    />
                  </label>
                  {definition.series === 'multi' && widget.series.length > 1 && (
                    <button type="button" aria-label={t('removeSeries', { name: series.name || t('seriesIndex', { index: seriesIndex + 1 }) })} onClick={() => removeSeries(index, widget, seriesIndex)}>×</button>
                  )}
                </div>
              ))}

              {definition.series === 'multi' && (
                <button type="button" className={styles.resumeAddEntry} onClick={() => addSeries(index, widget)}>{t('addSeries')}</button>
              )}
            </div>
          </fieldset>
        );
      })}

      <div className={styles.dashboardAddWidget}>
        <span>{widgets.length >= DASHBOARD_MAX_WIDGETS ? t('widgetLimit', { max: DASHBOARD_MAX_WIDGETS }) : t('addWidget')}</span>
        <div>
          {DASHBOARD_CHART_DEFINITIONS.map((definition) => (
            <button
              key={definition.chart}
              type="button"
              disabled={widgets.length >= DASHBOARD_MAX_WIDGETS}
              title={translate(`chart.${definition.chart}`)}
              aria-label={t('addChart', { name: translate(`chart.${definition.chart}`) })}
              onClick={() => add(definition.chart)}
            >
              <i aria-hidden>{definition.glyph}</i>
              <b>{translate(`chart.${definition.chart}`)}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
