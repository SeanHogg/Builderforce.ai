import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { slugify } from '@builderforce/creation-canvas-contract';
import styles from '../styles/creativeEditors.module.css';
import type { CreationBodyProps } from './types';
import { ComicPageView } from '../comic/ComicPageView';
import { ComicPageRail } from '../comic/ComicPageRail';
import { ComicPanelInspector } from '../comic/ComicPanelInspector';
import { ComicBranchEditor } from '../comic/ComicBranchEditor';
import { ComicReader } from '../comic/ComicReader';
import { useComicEditor } from '../comic/useComicEditor';
import { useExportArtifact } from '../creative/useExportArtifact';
import { useExportPalette } from '../creative/useExportPalette';
import { useCreationNodeActions } from './nodeActions';
import { ExportNotice } from '../creative/ExportNotice';
import { COMIC_EXPORT_FORMATS, ComicExportError, renderComic, type ComicExportFormat } from '@/lib/creation/comic/comicExport';
import { isInteractiveComic } from '@/lib/creation/comic/comicState';

const EXPORT_KEY = { cbz: 'exportCbz', 'png-strip': 'exportPng', pdf: 'exportPdf' } as const;

/**
 * A comic, laid out, lettered, read and exported on the card itself. Pages of panels are
 * `data.comicPages`; a page that offers choices turns the comic into a branching one,
 * which the Read view plays.
 */
export function ComicBody({ data }: CreationBodyProps) {
  const t = useTranslations('canvas.kinds.comic');
  const editor = useComicEditor(data);
  const { state, page, panel, editable, actions } = editor;
  const [mode, setMode] = useState<'edit' | 'read'>(editable ? 'edit' : 'read');
  const reading = mode === 'read' || !editable;

  const palette = useExportPalette();
  const { edit: onEdit } = useCreationNodeActions();
  const exporter = useExportArtifact<ComicExportFormat>({
    data,
    artifactKind: 'comic',
    onEdit,
    render: async (format, object) => {
      const { blob } = await renderComic(state, format, palette);
      const spec = COMIC_EXPORT_FORMATS.find((entry) => entry.format === format)!;
      const stem = slugify(object.title, { maxLength: 60, fallback: 'comic' });
      return {
        blob, mimeType: spec.mimeType, label: spec.extension.toUpperCase(),
        fileName: format === 'png-strip' ? `${stem}-strip.${spec.extension}` : `${stem}.${spec.extension}`,
        detail: `${state.pages.length} pages · ${spec.extension.toUpperCase()}`,
        metadata: { pages: state.pages.length },
      };
    },
  });

  return <div className={styles.editor}>
    <div className={`${styles.toolbar} nodrag nowheel`}>
      {editable && <div className={styles.group} role="group" aria-label={t('mode')}>
        <button type="button" className={styles.button} data-active={mode === 'edit' || undefined} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>{t('edit')}</button>
        <button type="button" className={styles.button} data-active={mode === 'read' || undefined} aria-pressed={mode === 'read'} onClick={() => setMode('read')}>{t('read')}</button>
      </div>}
      <span className={styles.summary}>
        <span>{t('summary', { pages: state.pages.length })}</span>
        {isInteractiveComic(state) && <span>{t('branching')}</span>}
      </span>
    </div>

    {reading
      ? <ComicReader state={state} />
      : <>
        <ComicPageView
          page={page}
          size={state}
          selectedPanelId={panel?.id ?? null}
          onSelectPanel={editor.selectPanel}
          pageLabel={t('pageOf', { index: state.pages.indexOf(page) + 1, total: state.pages.length })}
          panelLabel={(index) => t('panelNumber', { index })}
        />
        <ComicPageRail
          state={state}
          page={page}
          editable={editable}
          onSelect={editor.selectPage}
          onAdd={actions.addPage}
          onRemove={actions.removePage}
          onMove={actions.movePage}
          onLayout={actions.setLayout}
        />
        {panel && <ComicPanelInspector
          panel={panel}
          panelNumber={page.panels.indexOf(panel) + 1}
          onImage={actions.setImage}
          onAddBubble={actions.addBubble}
          onUpdateBubble={actions.updateBubble}
          onRemoveBubble={actions.removeBubble}
        />}
        <ComicBranchEditor state={state} page={page} onAdd={actions.addBranch} onUpdate={actions.updateBranch} onRemove={actions.removeBranch} />
      </>}

    <div className={`${styles.toolbar} nodrag nowheel`} role="group" aria-label={t('export')}>
      {COMIC_EXPORT_FORMATS.map((spec) => <button key={spec.format} type="button" className={styles.button} disabled={exporter.status === 'busy'} onClick={() => exporter.run(spec.format)}>
        {t(EXPORT_KEY[spec.format])}
      </button>)}
      {exporter.status === 'busy' && <span className={styles.status} role="status">{t('exporting')}</span>}
      {exporter.status === 'failed' && <span className={styles.status} role="alert">{exporter.error instanceof ComicExportError ? t('exportTooTall') : t('exportFailed')}</span>}
      <ExportNotice status={exporter.status} />
    </div>
  </div>;
}
