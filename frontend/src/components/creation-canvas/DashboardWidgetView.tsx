import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import {
  DASHBOARD_MAX_CATEGORIES,
  dashboardChartDefinition,
  type DashboardSeries,
  type DashboardWidget,
} from '@/lib/canvasDashboard';

/**
 * The ONE renderer for a dashboard widget.
 *
 * Both the Object card and the editor's live preview mount this, which is what makes
 * the editor WYSIWYG rather than a form that happens to sit next to a picture: there
 * is no second drawing of a bar chart that could disagree with the first.
 *
 * ── WHY NOT `components/charts/*` ────────────────────────────────────────────────
 * The board declares its OWN palette and surfaces (see the header of
 * CreationCanvas.module.css: "What must never happen is a board hue inheriting the
 * SHELL's tokens"). The shared chart primitives are built on the shell's tokens
 * (`CHART_PALETTE`, `--text-secondary`, `--border-subtle`), so mounting them inside a
 * card would flatten a board hue into a shell hue — the exact drift that file exists
 * to prevent. These marks therefore draw on `--canvas-series-*` and `--canvas-ink`,
 * and stay inside the board's bounded context.
 */

/** The board's eight series identities, declared in CreationCanvas.module.css. */
const SERIES_TOKENS = [
  'var(--canvas-series-1)', 'var(--canvas-series-2)', 'var(--canvas-series-3)', 'var(--canvas-series-4)',
  'var(--canvas-series-5)', 'var(--canvas-series-6)', 'var(--canvas-series-7)', 'var(--canvas-series-8)',
] as const;

function seriesColor(index: number): string {
  return SERIES_TOKENS[((index % SERIES_TOKENS.length) + SERIES_TOKENS.length) % SERIES_TOKENS.length]!;
}

/** The value at `index`, as a finite number. Charts are drawn from ragged author input,
 *  so a short series is zero-filled rather than left as a hole in the mark. */
function at(series: DashboardSeries | undefined, index: number): number {
  const value = series?.values[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Categories actually drawn: the author's labels, widened to cover any series that is
 *  longer than them so no authored number is invisible. */
function categoriesOf(widget: DashboardWidget): string[] {
  const longest = widget.series.reduce((max, series) => Math.max(max, series.values.length), 0);
  const count = Math.min(DASHBOARD_MAX_CATEGORIES, Math.max(widget.labels.length, longest));
  return Array.from({ length: count }, (_, index) => widget.labels[index] ?? '');
}

function maxOf(widget: DashboardWidget, categories: string[]): number {
  const values = categories.flatMap((_, index) => widget.series.map((series) => at(series, index)));
  return Math.max(1, ...values.filter((value) => value > 0));
}

/** Compact number for a mark label — a card has no room for "1,284,000". */
function short(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (abs >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(Math.round(value * 10) / 10);
}

/** Only meaningful once there is more than one mark to tell apart — a single series
 *  names itself in the widget's sub-caption instead. */
function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <div className={styles.dwLegend}>
      {names.map((name, index) => (
        <span key={`${name}-${index}`}><i style={{ background: seriesColor(index) }} />{name}</span>
      ))}
    </div>
  );
}

/** Points for a line/area mark in a 100×40 box, drawn with a non-scaling stroke so the
 *  distorted aspect ratio never thickens the line. */
function pointsFor(widget: DashboardWidget, series: DashboardSeries, categories: string[], max: number): string {
  const step = categories.length > 1 ? 100 / (categories.length - 1) : 0;
  return categories
    .map((_, index) => `${(index * step).toFixed(2)},${(40 - (at(series, index) / max) * 36).toFixed(2)}`)
    .join(' ');
}

export function DashboardWidgetView({ widget }: { widget: DashboardWidget }) {
  const t = useTranslations('creationCanvas.dashboard');
  const definition = dashboardChartDefinition(widget.chart);
  const categories = definition.categories ? categoriesOf(widget) : [];
  const max = maxOf(widget, categories);
  const primary = widget.series[0];
  const names = widget.series.map((series, index) => series.name || t('seriesIndex', { index: index + 1 }));
  const describe = () => categories.map((label, index) =>
    `${label || t('categoryIndex', { index: index + 1 })}: ${widget.series.map((series) => short(at(series, index))).join(' / ')}`).join(', ');

  const body = () => {
    switch (widget.chart) {
      case 'kpi':
        return (
          <div className={styles.dwMetric}>
            <strong>{widget.value || '—'}</strong>
            {widget.trend && <em>{widget.trend}</em>}
          </div>
        );

      case 'bar':
        return (
          <div className={styles.dwBars} role="img" aria-label={describe()}>
            {categories.map((label, index) => (
              <div key={`${label}-${index}`}>
                <span title={label}>{label}</span>
                <i style={{ width: `${Math.max(3, (at(primary, index) / max) * 100)}%`, background: seriesColor(index) }} />
                <b>{short(at(primary, index))}</b>
              </div>
            ))}
          </div>
        );

      case 'column':
        return (
          <div className={styles.dwColumns} role="img" aria-label={describe()}>
            {categories.map((label, index) => (
              <div key={`${label}-${index}`}>
                <b>{short(at(primary, index))}</b>
                <i style={{ height: `${Math.max(3, (at(primary, index) / max) * 100)}%`, background: seriesColor(index) }} />
                <span title={label}>{label}</span>
              </div>
            ))}
          </div>
        );

      case 'line':
      case 'area':
        return (
          <div className={styles.dwPlot} role="img" aria-label={describe()}>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
              {widget.series.map((series, index) => {
                const points = pointsFor(widget, series, categories, max);
                return (
                  <g key={series.id}>
                    {widget.chart === 'area' && (
                      <polygon points={`0,40 ${points} 100,40`} fill={seriesColor(index)} opacity={0.22} />
                    )}
                    <polyline points={points} fill="none" stroke={seriesColor(index)} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  </g>
                );
              })}
            </svg>
            <div className={styles.dwAxis}>{categories.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
            <Legend names={names} />
          </div>
        );

      case 'donut': {
        const total = categories.reduce((sum, _, index) => sum + Math.max(0, at(primary, index)), 0);
        let cursor = 0;
        const stops = categories.map((_, index) => {
          const start = total ? (cursor / total) * 100 : 0;
          cursor += Math.max(0, at(primary, index));
          const end = total ? (cursor / total) * 100 : 0;
          return `${seriesColor(index)} ${start}% ${end}%`;
        }).join(', ');
        return (
          <div className={styles.donutChart}>
            <div className={styles.donut} role="img" aria-label={describe()} style={total > 0 ? { background: `conic-gradient(${stops})` } : undefined} />
            <div className={styles.donutLegend}>
              {categories.map((label, index) => (
                <span key={`${label}-${index}`} title={`${label}: ${at(primary, index)}`}>
                  <i style={{ background: seriesColor(index) }} /><b>{label}</b><em>{short(at(primary, index))}</em>
                </span>
              ))}
            </div>
          </div>
        );
      }

      case 'stackedBar':
        return (
          <div className={styles.dwStack} role="img" aria-label={describe()}>
            {categories.map((label, index) => {
              const total = widget.series.reduce((sum, series) => sum + Math.max(0, at(series, index)), 0);
              return (
                <div key={`${label}-${index}`} className={styles.dwStackRow}>
                  <span title={label}>{label}</span>
                  <div>
                    {widget.series.map((series, seriesIndex) => (
                      <i
                        key={series.id}
                        style={{ width: `${total ? (Math.max(0, at(series, index)) / total) * 100 : 0}%`, background: seriesColor(seriesIndex) }}
                        title={`${names[seriesIndex]}: ${at(series, index)}`}
                      />
                    ))}
                  </div>
                  <b>{short(total)}</b>
                </div>
              );
            })}
            <Legend names={names} />
          </div>
        );

      case 'funnel':
        return (
          <div className={styles.dwFunnel} role="img" aria-label={describe()}>
            {categories.map((label, index) => (
              <div key={`${label}-${index}`}>
                <span title={label}>{label}</span>
                <i style={{ width: `${Math.max(8, (at(primary, index) / max) * 100)}%`, background: seriesColor(index) }} />
                <b>{short(at(primary, index))}</b>
              </div>
            ))}
          </div>
        );

      case 'gauge': {
        const value = at(primary, 0);
        const target = widget.target && widget.target > 0 ? widget.target : max;
        const fraction = Math.max(0, Math.min(1, value / target));
        const arc = Math.PI * 40;
        return (
          <div className={styles.dwGauge} role="img" aria-label={`${short(value)} / ${short(target)}${widget.unit ? ` ${widget.unit}` : ''}`}>
            <svg viewBox="0 0 100 56" aria-hidden>
              <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="var(--canvas-widget-border)" strokeWidth={10} strokeLinecap="round" />
              <path
                d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke={seriesColor(0)} strokeWidth={10} strokeLinecap="round"
                strokeDasharray={`${arc * fraction} ${arc}`}
              />
            </svg>
            <strong>{short(value)}{widget.unit}</strong>
            <em>{t('ofTarget', { target: `${short(target)}${widget.unit}` })}</em>
          </div>
        );
      }

      case 'table':
        return (
          <div className={styles.dwTable}>
            <table>
              <thead>
                <tr><th scope="col">{t('category')}</th>{names.map((name, index) => <th key={`${name}-${index}`} scope="col">{name}</th>)}</tr>
              </thead>
              <tbody>
                {categories.map((label, index) => (
                  <tr key={`${label}-${index}`}>
                    <th scope="row">{label || t('categoryIndex', { index: index + 1 })}</th>
                    {widget.series.map((series) => <td key={series.id}>{short(at(series, index))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      default:
        return null;
    }
  };

  const empty = definition.metric
    ? !widget.value.trim()
    : definition.series !== 'none' && widget.series.every((series) => series.values.length === 0);

  // What the numbers ARE, when there is one series and the author named it (a legacy
  // object's `yAxisLabel` lands here). A legend of one row would say the same thing
  // with a colour swatch that distinguishes it from nothing.
  const seriesCaption = definition.series !== 'none' && widget.series.length === 1
    ? widget.series[0]?.name ?? ''
    : '';

  return (
    <figure className={styles.dwWidget} data-span={widget.span} data-chart={widget.chart}>
      {widget.title && <figcaption>{widget.title}</figcaption>}
      {seriesCaption && <small className={styles.dwSeriesName}>{seriesCaption}</small>}
      {empty ? <p className={styles.dwEmptyWidget}>{t('widgetEmpty')}</p> : body()}
    </figure>
  );
}

/** The dashboard's grid. One place decides how widgets flow, so the card and the
 *  editor preview cannot lay the same dashboard out differently. */
export function DashboardWidgetGrid({ widgets }: { widgets: readonly DashboardWidget[] }) {
  return (
    <div className={styles.dwGrid}>
      {widgets.map((widget) => <DashboardWidgetView key={widget.id} widget={widget} />)}
    </div>
  );
}
