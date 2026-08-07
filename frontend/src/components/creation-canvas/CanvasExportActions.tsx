'use client';

/**
 * "Take this away as…" — the one download row, wherever it appears.
 *
 * There were seven of these, hand-written as inline kind conditions in the
 * inspector, plus a two-button copy on the document card. That is how the card
 * came to offer Word and PDF for a document while the inspector offered Word and
 * Markdown for the same object, and how a deck, a sheet and a diagram ended up
 * with no download on their cards at all.
 *
 * The row decides its OWN visibility, per the shared-component rule: it reads
 * the object, asks {@link exportActionsFor} what that kind offers, drops the
 * formats this particular object cannot currently fill — a sheet with no rows, a
 * diagram still resolving its source — and renders nothing when nothing is left.
 * No caller passes a `canExport` boolean it would have to compute itself.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';
import { exportActionsFor, type CanvasExportAction } from '@/lib/canvasExports';
import { canvasDiagram, canvasSlides } from '@/lib/canvasDocuments';
import { canPrintCanvasObject } from '@/lib/printDocument';
import { tabularFromObject } from '@/lib/canvasTabularData';

/**
 * Whether an object can actually FILL a format right now.
 *
 * Absent from this map means "always" — a document always has at least a title
 * to write out. Present means the format is real only under a condition, and an
 * unmet condition removes the button rather than disabling it: a control that
 * appears the moment the first row lands is the affordance itself.
 */
const AVAILABILITY: Partial<Record<CanvasExportAction, (data: CreationNodeData) => boolean>> = {
  csv: (data) => tabularFromObject(data as Record<string, unknown>).columns.length > 0,
  xlsx: (data) => tabularFromObject(data as Record<string, unknown>).columns.length > 0,
  diagram: (data) => !!canvasDiagram(data),
  svg: (data) => !!canvasDiagram(data),
  pptx: (data) => canvasSlides(data).length > 0,
  pdf: canPrintCanvasObject,
};

/**
 * The formats THIS object can actually produce right now.
 *
 * Exported because a surface that FRAMES the row — the inspector, with its
 * "Copy & download" heading — has to know whether there is anything to frame.
 * One filter, two readers, so a heading can never sit above an empty row.
 */
export function canvasExportActionsFor(data: CreationNodeData): readonly CanvasExportAction[] {
  return exportActionsFor(data.kind).filter((action) => AVAILABILITY[action]?.(data) ?? true);
}

export interface CanvasExportActionsProps {
  data: CreationNodeData;
  onExport: (action: CanvasExportAction) => void;
  /** Presentational override for a surface that is not a card — the inspector
   * reads at panel scale, not at the card's compact scale. */
  className?: string;
}

export function CanvasExportActions({ data, onExport, className }: CanvasExportActionsProps) {
  const t = useTranslations('creationCanvas.export');
  const node = useTranslations('creationCanvas.node');
  const actions = useMemo(() => canvasExportActionsFor(data), [data]);
  if (!actions.length) return null;

  /** A diagram's own notation is its native format, so the button names the
   * notation rather than saying "Diagram" for two different file types. */
  const label = (action: CanvasExportAction) => action === 'diagram'
    ? node(canvasDiagram(data)?.format === 'mermaid' ? 'diagramMermaid' : 'diagramDrawio')
    : t(action);

  return <div className={`${styles.cardActions} ${className ?? ''} nodrag nowheel`} role="group" aria-label={t('group')}>
    {actions.map((action) => <button
      key={action}
      type="button"
      onClick={(event) => { event.stopPropagation(); onExport(action); }}
    >{label(action)}</button>)}
  </div>;
}
