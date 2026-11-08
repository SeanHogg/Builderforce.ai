import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import cad from '../cad/cadEditor.module.css';
import { AuthedImg } from '../creative/AuthedMedia';
import { creativePreviewImageUrl } from '@/lib/creationDeliverables';
import type { CadTool } from '@/lib/creation/cad/cadTools';
import type { CreationBodyProps } from './types';
import { CadLayersPanel } from '../cad/CadLayersPanel';
import { CadSheet } from '../cad/CadSheet';
import { CadToolbar } from '../cad/CadToolbar';
import { useCadEditor } from '../cad/useCadEditor';
import { useThemeColors } from '../creative/useThemeColors';

const THEME_TOKENS = { accent: '--canvas-accent' } as const;

/**
 * A 2D technical drawing, drafted on the card: lines, rectangles, circles and
 * dimensions on layers, exported as SVG, DXF, a true-size PDF, or extruded to STL/STEP.
 * The drawing is `data.cadState`; a viewer sees it and can select, but not change it.
 */
export function CadBody({ data }: CreationBodyProps) {
  const t = useTranslations('canvas.kinds.cad');
  const editor = useCadEditor(data);
  const { state, editable, selection, exporter } = editor;
  const [tool, setTool] = useState<CadTool>('select');
  const rootRef = useRef<HTMLDivElement>(null);
  const colors = useThemeColors(THEME_TOKENS, rootRef);
  const imported = !data.cadState ? creativePreviewImageUrl(data) : null;

  return <div className={styles.editor} ref={rootRef}>
    <div className={styles.summary}>
      <span>{t('summary', { width: state.widthMm, height: state.heightMm, unit: state.unit, shapes: state.shapes.length })}</span>
      {!editable && <span>{t('viewOnly')}</span>}
    </div>
    <CadToolbar
      tool={tool}
      editable={editable}
      canDelete={selection.length > 0}
      grid={state.grid}
      exportStatus={exporter.status}
      exportingFormat={exporter.format}
      onTool={setTool}
      onDelete={editor.deleteSelected}
      onGrid={editor.setGrid}
      onExport={exporter.run}
    />
    {/* A dropped DXF has a picture of itself but no editable shapes: show it until a drawing exists. */}
    {imported && <AuthedImg className={cad.imported} src={imported} alt={t('sheetLabel', { title: String(data.title ?? '') })} width={480} height={340} />}
    <CadSheet
      state={state}
      selection={selection}
      tool={tool}
      editable={editable}
      label={t('sheetLabel', { title: String(data.title ?? '') })}
      selectionInk={colors.accent}
      paper={editor.palette.paper}
      gridInk={editor.palette.gridLine}
      onDraw={editor.draw}
      onSelect={editor.setSelection}
    />
    {editable && state.shapes.length === 0 && <span className={styles.hint}>{t('emptyHint')}</span>}
    <CadLayersPanel
      state={state}
      editable={editable}
      onAdd={() => editor.layers.add(t('layers.newName'))}
      onRemove={editor.layers.remove}
      onUpdate={editor.layers.update}
      onActivate={editor.layers.activate}
    />
  </div>;
}
