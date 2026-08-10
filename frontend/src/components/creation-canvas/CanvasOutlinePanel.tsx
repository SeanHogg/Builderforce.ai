'use client';

import { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';
import styles from './CreationCanvas.module.css';
import type { CreationFlowNode } from './CreationNode';

/**
 * The accessible canvas outline — the spatial graph as an ordered, focusable list.
 *
 * It used to sit permanently on the board as a `<details>` widget that nobody could
 * dismiss. It is now opened from the accessibility control on the canvas command
 * rail and closes like every other canvas panel, so assistive-technology users get
 * the same "open it when I want it" control as everyone else.
 */
export function CanvasOutlinePanel({
  nodes, edges, onFocus, onClose,
}: {
  nodes: CreationFlowNode[];
  edges: Edge[];
  onFocus: (nodeId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('creationCanvas');
  return (
    <aside className={styles.canvasOutline} aria-label={t('canvasOutline')}>
      <header>
        <strong>{t('canvasOutline')}</strong>
        <button type="button" aria-label={t('closeCanvasOutline')} title={t('closeCanvasOutline')} onClick={onClose}>×</button>
      </header>
      {nodes.length === 0
        ? <p className={styles.canvasOutlineEmpty}>{t('canvasOutlineEmpty')}</p>
        : <ol>{nodes.map((node) => <li key={node.id}>
          <button type="button" aria-label={t('focusObject', { title: node.data.title })} onClick={() => onFocus(node.id)}>{node.data.title} ({node.data.kind})</button>
          <span>{node.data.status || t('canvasObject')}{node.data.placementLocked === true ? ` · ${t('placementLocked')}` : ''}</span>
          <ul>{edges.filter((edge) => edge.source === node.id).map((edge) => <li key={edge.id}>
            {t('outlineConnection', {
              kind: String(edge.data?.connectionKind || 'reference'),
              target: nodes.find((target) => target.id === edge.target)?.data.title || t('genericObject'),
            })}{edge.label ? `: ${String(edge.label)}` : ''}
          </li>)}</ul>
        </li>)}</ol>}
    </aside>
  );
}
