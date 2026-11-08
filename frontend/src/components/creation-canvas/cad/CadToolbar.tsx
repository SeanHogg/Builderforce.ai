import { useTranslations } from 'next-intl';
import { CAD_EXPORT_FORMATS, CAD_EXPORT_ORDER, type CadExportFormat } from '@/lib/creation/cad/cadExport';
import type { CadGrid } from '@/lib/creation/cad/cadState';
import { CAD_TOOLS, type CadTool } from '@/lib/creation/cad/cadTools';
import type { ExportStatus } from '../creative/useExportArtifact';
import { ExportNotice } from '../creative/ExportNotice';
import styles from '../styles/creativeEditors.module.css';

export interface CadToolbarProps {
  tool: CadTool;
  editable: boolean;
  canDelete: boolean;
  grid: CadGrid;
  exportStatus: ExportStatus;
  exportingFormat: CadExportFormat | null;
  onTool: (tool: CadTool) => void;
  onDelete: () => void;
  onGrid: (patch: Partial<CadGrid>) => void;
  onExport: (format: CadExportFormat) => void;
}

/** Tools, grid switches and the export row — controls only; the container decides what each does. */
export function CadToolbar({ tool, editable, canDelete, grid, exportStatus, exportingFormat, onTool, onDelete, onGrid, onExport }: CadToolbarProps) {
  const t = useTranslations('canvas.kinds.cad');
  const busy = exportStatus === 'busy';
  const toolLabels: Record<CadTool, string> = { select: t('tools.select'), line: t('tools.line'), rect: t('tools.rect'), circle: t('tools.circle'), dimension: t('tools.dimension') };
  return <>
    <div className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label={t('tools.label')}>
        {CAD_TOOLS.map((id) => <button
          key={id}
          type="button"
          className={styles.button}
          data-active={tool === id || undefined}
          aria-pressed={tool === id}
          disabled={id !== 'select' && !editable}
          onClick={() => onTool(id)}
        >{toolLabels[id]}</button>)}
      </div>
      <div className={styles.group}>
        <button type="button" className={styles.button} disabled={!editable || !canDelete} onClick={onDelete}>{t('deleteSelected')}</button>
        <button type="button" className={styles.button} data-active={grid.showGrid || undefined} aria-pressed={grid.showGrid} disabled={!editable} onClick={() => onGrid({ showGrid: !grid.showGrid })}>{t('showGrid')}</button>
        <button type="button" className={styles.button} data-active={grid.snapEnabled || undefined} aria-pressed={grid.snapEnabled} disabled={!editable} onClick={() => onGrid({ snapEnabled: !grid.snapEnabled })}>{t('snapToGrid')}</button>
      </div>
    </div>
    <div className={styles.toolbar}>
      <div className={styles.group} role="group" aria-label={t('export.label')}>
        {CAD_EXPORT_ORDER.map((format) => <button key={format} type="button" className={styles.button} disabled={busy} onClick={() => onExport(format)}>{CAD_EXPORT_FORMATS[format].label}</button>)}
      </div>
      <span className={styles.status} role="status" aria-live="polite">
        {busy ? t('export.busy', { format: exportingFormat ? CAD_EXPORT_FORMATS[exportingFormat].label : '' }) : exportStatus === 'done' ? t('export.done') : exportStatus === 'failed' ? t('export.failed') : ''}
      </span>
      <ExportNotice status={exportStatus} />
    </div>
    <span className={styles.hint}>{t('export.solidHint')}</span>
  </>;
}
