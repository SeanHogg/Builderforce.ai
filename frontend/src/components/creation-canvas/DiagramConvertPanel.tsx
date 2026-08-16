'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { diagramConvertSource, diagramConvertTargets } from '@/lib/canvasDiagramConvert';
import { canvasDiagram } from '@/lib/canvasDocuments';
import type { DiagramNotation } from '@/lib/diagramNotations';
import type { CreationFlowNode } from './CreationNode';
import styles from './CreationCanvas.module.css';

/**
 * "Convert this to…" — the destinations THIS object can actually reach.
 *
 * ── WHY THE PANEL ASKS THE SOURCE ────────────────────────────────────────────
 * The old panel showed one button, "create a draw.io file", on two kinds of
 * object. It could afford to be static because there was one destination.
 * There are now six, and which of them are reachable depends on what the source
 * turns out to hold: an object with real shapes (a diagram in another notation,
 * a vector image, a CAD drawing) can be written to any of them, while a
 * photograph or a freehand sketch has no shapes to write and can only be
 * EMBEDDED — which only draw.io does.
 *
 * So the panel resolves the source first and offers what came back. Listing all
 * six on a photograph would be an interface that fails after the click, and
 * listing one on a Lucidchart SVG export would hide the reason the import
 * exists.
 *
 * It decides its OWN visibility: a node with nothing convertible renders
 * nothing, so no caller has to work out whether to mount it.
 */
export function DiagramConvertPanel({ node, nodes, onConvert }: {
  node: CreationFlowNode;
  nodes: readonly CreationFlowNode[];
  onConvert: (format: string, diagramId?: string) => Promise<string>;
}) {
  const t = useTranslations('creationCanvas');
  const [targets, setTargets] = useState<DiagramNotation[] | null>(null);
  const [embeds, setEmbeds] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const { data } = node;
  useEffect(() => {
    let cancelled = false;
    setTargets(null);
    void diagramConvertSource(data).then((source) => {
      if (cancelled) return;
      setTargets(source ? diagramConvertTargets(source) : []);
      setEmbeds(source?.kind === 'asset');
    });
    return () => { cancelled = true; };
  }, [data]);

  // Only a picture can be ADDED to an existing draw.io file. A graph conversion
  // replaces a notation; merging two scenes is a different operation.
  const existing = embeds
    ? nodes.filter((candidate) => candidate.id !== node.id && candidate.data.kind === 'diagram' && canvasDiagram(candidate.data)?.format === 'drawio')
    : [];

  if (!targets?.length) return null;

  const run = async (format: string, diagramId?: string): Promise<void> => {
    setBusy(true);
    setStatus(await onConvert(format, diagramId));
    setBusy(false);
  };

  return <section className={styles.taskPrdSummary} aria-label={t('diagramConvertTitle')}>
    <div><span>{t('diagramConvertTitle')}</span><small>{targets.length}</small></div>
    <p>{t(embeds ? 'diagramConvertEmbedHint' : 'diagramConvertGraphHint')}</p>
    {targets.map((notation) => <button
      key={notation.id}
      type="button"
      className={styles.fullButton}
      disabled={busy}
      onClick={() => { void run(notation.id, '__new__'); }}
    >{t('diagramConvertAction', { notation: notation.name })}</button>)}
    {existing.map((diagram) => <button
      key={diagram.id}
      type="button"
      className={styles.secondaryFullButton}
      disabled={busy}
      onClick={() => { void run('drawio', diagram.id); }}
    >{t('drawioAddAction', { name: diagram.data.title })}</button>)}
    {status && <small role="status" className={styles.inspectorHint}>{status}</small>}
  </section>;
}
