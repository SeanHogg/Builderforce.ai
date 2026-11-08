import { useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasStroke, DrawingPen } from '@/lib/canvasDrawing';
import { annotationSpace, isImageEditIdentity, undoImageStroke, IMAGE_EXPORT_FORMATS, type ImageExportFormat } from '@/lib/creation/image/imageEdit';
import { readDrawingPreferences, writeDrawingPreferences } from '../drawingPreferences';
import type { CreationBodyProps } from '../bodies/types';
import { useCreationNodeActions } from '../bodies/nodeActions';
import { ImageAnnotateLayer } from './ImageAnnotateLayer';
import { ImageAnnotateTools } from './ImageAnnotateTools';
import { ImageEditorControls } from './ImageEditorControls';
import { ExportNotice } from '../creative/ExportNotice';
import { useImageEditor } from './useImageEditor';
import styles from './ImageEditor.module.css';

type Mode = 'adjust' | 'annotate';
const MODES: readonly Mode[] = ['adjust', 'annotate'];
const FORMATS = Object.keys(IMAGE_EXPORT_FORMATS) as ImageExportFormat[];

/** The live preview canvas. Its callback ref arrives as a plain prop, so the editor's state stays separate from the DOM handle. */
function PreviewCanvas({ bind, label }: { bind: (element: HTMLCanvasElement | null) => void; label: string }) {
  return <canvas ref={bind} className={styles.preview} role="img" aria-label={label} />;
}

/**
 * The `image` card: the picture, edited non-destructively in place. The container owns
 * the mode and the pen; `useImageEditor` owns the edit stack and the export; the layers
 * and trays are presentational.
 */
export function ImageEditorBody({ data }: CreationBodyProps) {
  const { edit: onEdit } = useCreationNodeActions();
  const t = useTranslations('canvas.kinds.image');
  const [mode, setMode] = useState<Mode>('adjust');
  const editor = useImageEditor(data, onEdit, mode === 'annotate');
  // The remembered pen is browser storage (the server render reads the default); it only shows
  // once the annotate tray is open, which is never part of the server render.
  const [pen, setPen] = useState<DrawingPen>(readDrawingPreferences);
  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const choose = (patch: Partial<DrawingPen>) => setPen((current) => { const next = { ...current, ...patch }; writeDrawingPreferences(next); return next; });

  const { edit, output } = editor;
  const space = output ? annotationSpace(output.width, output.height) : null;
  const modeLabel: Record<Mode, string> = { adjust: t('mode.adjust'), annotate: t('mode.annotate') };
  const problemLabel = { load: t('problem.load'), export: t('problem.export'), import: t('problem.import') };
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void editor.importFile(file);
  };

  /** The surface hands back the whole stroke list. A bare text tap arrives as an empty text
   *  stroke: it is held back until the words are typed, then committed with them. */
  const changeStrokes = (strokes: CanvasStroke[]) => {
    const added = strokes.length > edit.strokes.length ? strokes[strokes.length - 1] : undefined;
    if (added?.tool === 'text' && !added.text) { setTextAt(added.points[0] ?? null); return; }
    editor.update({ ...edit, strokes });
  };

  return <div className={`${styles.editor} nodrag`}>
    {editor.baseUrl ? <div className={styles.stage}>
      <PreviewCanvas bind={editor.bindPreview} label={t('previewAlt', { title: data.title })} />
      {editor.editable && mode === 'annotate' && space && <ImageAnnotateLayer
        space={space}
        strokes={edit.strokes}
        pen={pen}
        label={t('annotateLayer')}
        onChange={changeStrokes}
      />}
    </div> : <p className={styles.empty}>{t('empty')}</p>}

    {editor.problem && <p className={styles.problem} role="alert">{problemLabel[editor.problem]}</p>}
    <ExportNotice status={editor.exportStatus} />

    {editor.editable && <>
      {editor.baseUrl && <div className={styles.row} role="tablist" aria-label={t('modes')}>
        {MODES.map((id) => <button key={id} type="button" role="tab" className={styles.toolButton} aria-selected={mode === id} onClick={() => setMode(id)}>{modeLabel[id]}</button>)}
      </div>}
      {editor.baseUrl && mode === 'adjust' && <ImageEditorControls edit={edit} onChange={editor.update} />}
      {editor.baseUrl && mode === 'annotate' && <ImageAnnotateTools
        pen={pen}
        onChoose={choose}
        canUndo={edit.strokes.length > 0}
        onUndo={() => editor.update(undoImageStroke(edit))}
        textPending={!!textAt}
        onCommitText={(text) => { if (textAt) editor.update({ ...edit, strokes: [...edit.strokes, { tool: 'text', points: [textAt], stroke: pen.color, strokeWidth: pen.width, text }] }); setTextAt(null); }}
        onCancelText={() => setTextAt(null)}
      />}
      <div className={styles.row}>
        <label className={styles.toolButton}>
          {editor.baseUrl ? t('replace') : t('import')}
          <input type="file" accept="image/*" className={styles.fileInput} disabled={editor.busy} onChange={pick} />
        </label>
        {editor.baseUrl && <button type="button" className={styles.toolButton} disabled={isImageEditIdentity(edit)} onClick={editor.reset}>{t('reset')}</button>}
        {editor.baseUrl && FORMATS.map((format) => <button key={format} type="button" className={styles.toolButton} disabled={!editor.loaded || editor.busy} onClick={() => void editor.exportAs(format)}>
          {t('exportAs', { format: IMAGE_EXPORT_FORMATS[format].label })}
        </button>)}
      </div>
    </>}
  </div>;
}
