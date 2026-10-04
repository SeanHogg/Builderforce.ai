import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from '../types';
import styles from '../CreationCanvas.module.css';
import { dashboardWidgetsPatch, readDashboardWidgets } from '@/lib/canvasDashboard';
import { DashboardWidgetGrid } from '../DashboardWidgetView';
import { DashboardStructuredEditor } from '../DashboardStructuredEditor';
import { useFormat } from '@/i18n/useFormat';
import type { CreationBodyProps } from './types';
import { useCreationNodeActions } from './nodeActions';
import { optionLabel } from './shared';

/**
 * The Dashboard / Chart / Report card.
 *
 * The card used to BE the layout: one bar list, one donut, and — when nothing was
 * authored — three invented KPIs ("Reach 212K") that made an empty object look like a
 * finished marketing dashboard. It is now a grid of authored widgets read through
 * {@link readDashboardWidgets}, so what a dashboard shows is data the author owns and
 * can add to, reorder, retype and delete. An unauthored dashboard says so instead of
 * inventing numbers.
 *
 * Editing happens BESIDE the drawing rather than instead of it: the grid stays mounted
 * while the editor is open and both render from the same array, which is what makes the
 * surface WYSIWYG.
 */
export function DashboardBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('creationCanvas.node');
  const fmt = useFormat();
  const [editing, setEditing] = useState(false);
  const widgets = useMemo(() => readDashboardWidgets(data as Record<string, unknown>), [data]);
  const dateRange = optionLabel(data.dateRange, { '30d': t('last30Days'), '7d': t('last7Days'), qtd: t('quarterToDate') }, t('last30Days'));
  return (
    <>
      {data.kind === 'dashboard' && <div className={styles.widgetContext}><span><small>{t('dateRange')}</small><b>{dateRange}</b></span>{typeof data.fetchedAt === 'string' && <span><small>{t('refreshed')}</small><b>{fmt.time(data.fetchedAt)}</b></span>}</div>}
      {widgets.length > 0
        ? <DashboardWidgetGrid widgets={widgets} />
        : <p className={styles.dwEmpty}>{onEdit ? t('dashboardEmptyEditable') : t('dashboardEmpty')}</p>}
      {typeof data.xAxisLabel === 'string' && data.xAxisLabel.trim() && <small className={styles.axisLabel}>{data.xAxisLabel}</small>}
      {onEdit && <div className={`${styles.cardActions} nodrag nowheel`}>
        <button
          type="button"
          data-active={editing ? 'true' : undefined}
          aria-pressed={editing}
          onClick={(event) => { event.stopPropagation(); setEditing(!editing); }}
        >{editing ? t('dashboardDone') : t('dashboardEdit')}</button>
      </div>}
      {onEdit && editing && <div className="nodrag nowheel" onClick={(event) => event.stopPropagation()}>
        <DashboardStructuredEditor
          widgets={widgets}
          onChange={(next) => onEdit(dashboardWidgetsPatch(next) as Partial<CreationNodeData>)}
        />
      </div>}
    </>
  );
}
