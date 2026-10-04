/** Importing a tabular file as a dataset object. */
import { type AttachmentBytesStrategy, fileToDataUrl, importCanvasFile } from '@/domains/canvas/application/ImportCanvasFile';
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import { uploadAttachmentSource } from '@/lib/canvasAttachmentUploadApi';
import { profileTabular, type TabularSource } from '@/lib/canvasTabularData';
import { createDefaultCreationData } from '../creationObjectRegistry';
import { classificationSummary, classifyTabular } from '@/lib/canvasDataGovernance';
import { faultText } from '@/lib/apiClient';
import { type CanvasJournal, describeGraphChange } from '@/lib/canvasActionJournal';
import type { CreationFlowNode } from '../CreationNode';
import type { Edge } from '@xyflow/react';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { useTranslations } from 'next-intl';
import type { Formatter } from '@/i18n/format';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';

export interface UseCanvasDatasetImportDeps {
  canvasText: CanvasTextTranslator;
  datasetRowLimit: number;
  edges: Edge[];
  fmt: Formatter;
  historyApplyingRef: RefObject<boolean>;
  historyBaselineRef: RefObject<string | null>;
  hydratedRef: RefObject<boolean>;
  importLabel: CanvasTextTranslator;
  journalRef: RefObject<CanvasJournal>;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  redoStackRef: RefObject<string[]>;
  selectedId: string | null;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  undoStackRef: RefObject<string[]>;
}

export function useCanvasDatasetImport({ canvasText, datasetRowLimit, edges, fmt, historyApplyingRef, historyBaselineRef, hydratedRef, importLabel, journalRef, nodes, persistence, redoStackRef, selectedId, setNodes, setNotice, t, undoStackRef }: UseCanvasDatasetImportDeps) {
  /**
   * How a dropped file's bytes survive past the import that could not read
   * them, so a later tool can still escalate it (OCR on a scan, a multimodal
   * read on a corrupted document). A signed-in, server-persisted session has a
   * tenant to scope an R2 upload to and later bill that read to, so its bytes
   * go there and only a key stays on the canvas object. A local/guest canvas
   * has neither, so the alternative is to keep the bytes inline as base64 —
   * unrealized cost if the draft is only ever a scratch board, but not lost if
   * the person later signs in and the draft is claimed, at which point the
   * same object can still be escalated.
   */
  const attachmentBytesStrategy: AttachmentBytesStrategy = useCallback(async (file: File) => {
    if (persistence === 'server') {
      try {
        return { sourceFileKey: await uploadAttachmentSource(file) };
      } catch {
        return null;
      }
    }
    const url = await fileToDataUrl(file);
    return url ? { sourceDataUrl: url } : null;
  }, [persistence]);

  /** Filling an existing Dataset object from a file reads it through the same
   * engine as a drop, so a workbook picked here loads exactly as one dropped on
   * the board rather than failing on a format only this path never learned. */
  const importDataset = useCallback(async (file: File) => {
    if (!selectedId) return;
    try {
      const [imported] = (await importCanvasFile(file, importLabel)).objects;
      const columns = Array.isArray(imported?.data.columns) ? imported.data.columns as string[] : [];
      const rows = Array.isArray(imported?.data.rows) ? imported.data.rows as TabularSource['rows'] : [];
      if (!columns.length) throw new Error(t('datasetNoColumns'));
      if (rows.length > datasetRowLimit) throw new Error(t('datasetRowLimit', { limit: fmt.number(datasetRowLimit) }));
      const { title: _title, ...fields } = imported!.data;
      // Adopt the imported file's name, but only over the palette's placeholder.
      // A card the user has already named is theirs and survives the import;
      // one that still says "Imported dataset.csv" after importing revenue.csv is
      // simply wrong, and every artifact derived from it — "… visualization",
      // the map, the chart — inherits that wrong name.
      // Both spellings: a card minted before default titles followed the board's
      // language still carries the English one.
      const placeholders = new Set([createDefaultCreationData('dataset').title, createDefaultCreationData('dataset', canvasText).title]);
      // Two facts are stamped at import because neither can be recovered later.
      // `fetchedAt` is what makes staleness computable at all — a dataset with no
      // timestamp is a snapshot of unknown age, and every chart built on it
      // inherits that silence. The PII scan runs here rather than on demand
      // because a restricted column must be masked from the FIRST render, not
      // from whenever someone remembers to ask.
      const source: TabularSource = { columns, rows };
      const classifications = classifyTabular(source, profileTabular(source));
      const governance = classificationSummary(classifications);
      setNodes((current) => current.map((node) => (node.id === selectedId
        ? { ...node, data: {
          ...node.data, ...fields,
          classifications, fetchedAt: new Date().toISOString(), sourceUri: file.name,
          ...(placeholders.has(node.data.title) ? { title: file.name } : {}),
        } }
        : node)));
      setNotice(governance.piiColumns
        ? t('datasetImportedWithPii', { name: file.name, rows: fmt.number(rows.length), columns: columns.length, pii: governance.piiColumns })
        : t('datasetImported', { name: file.name, rows: fmt.number(rows.length), columns: columns.length }));
    } catch (error) {
      setNotice(faultText(error, t('datasetImportFailed')));
    }
  }, [canvasText, datasetRowLimit, fmt, importLabel, selectedId, setNodes, setNotice, t]);

  useEffect(() => {
    if (!hydratedRef.current || historyApplyingRef.current) return;
    const next = JSON.stringify({ nodes, edges });
    const handle = window.setTimeout(() => {
      if (historyBaselineRef.current == null) historyBaselineRef.current = next;
      else if (historyBaselineRef.current !== next) {
        // Every board mutation — palette, drag, delete, inspector edit, an AI
        // proposal being applied, an undo — settles HERE, so this is the one
        // place that can record what the person did without a dozen handlers
        // each remembering to. See `describeGraphChange`.
        try {
          const change = describeGraphChange(
            JSON.parse(historyBaselineRef.current) as { nodes: CreationFlowNode[]; edges: Edge[] },
            { nodes, edges },
          );
          if (change) journalRef.current.record({ kind: 'user', label: change.label, detail: change.detail });
        } catch { /* the journal must never be able to break the history stack */ }
        undoStackRef.current = [...undoStackRef.current.slice(-49), historyBaselineRef.current];
        historyBaselineRef.current = next;
        redoStackRef.current = [];
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [edges, historyApplyingRef, historyBaselineRef, hydratedRef, journalRef, nodes, redoStackRef, undoStackRef]);
  return { attachmentBytesStrategy, importDataset };
}
