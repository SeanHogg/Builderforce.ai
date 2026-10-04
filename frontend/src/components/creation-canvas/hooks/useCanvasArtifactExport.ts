/** Exporting an object as an artifact in the format the person asked for. */
import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { type CanvasExportAction, EXPORT_EXTENSION, EXPORT_MIME, pdfExportStrategy, SERVER_RENDERED_ACTIONS } from '@/lib/canvasExports';
import { objectMayCross } from '@/lib/canvasConfidentiality';
import { evaluateDatasetUse, normalizeClassifications, normalizeUsePolicy } from '@/lib/canvasDataGovernance';
import { canvasDiagram, canvasObjectMarkdown } from '@/lib/canvasDocuments';
import { exportableSheet, safeDownloadName } from '../canvasArtifactExport';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { downloadBlob, downloadJson, downloadText, toCsv } from '@/lib/download';
import { renderedCanvasResume, resumeHtmlFile } from '@/lib/canvasResumeRenderer';
import { markdownHtmlDocument, printCanvasObject } from '@/lib/printDocument';
import { exportCsv, exportDocx, exportPdf, exportPptx, exportXlsx, OfficeExportUnavailableError } from '@/lib/exportApi';
import { diagramNotation } from '@/lib/diagramNotations';
import { canvasObjectSvg } from '@/lib/renderedSvg';
import { canvasSpecSource, releaseGateEvidence } from '../canvasReleaseEvidence';
import { normalizeExitCriteria, releaseEvidence } from '@/lib/canvasQa';
import { buildScormPackage, courseFromNode } from '@/lib/courseLms';
import { type CreationDeliverable, withCreationDeliverable } from '@/lib/creationDeliverables';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { useTranslations } from 'next-intl';
import type { Edge } from '@xyflow/react';

export interface UseCanvasArtifactExportDeps {
  edges: Edge[];
  nodes: CanvasObject[];
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasArtifactExport({ edges, nodes, setNodes, setNotice, t }: UseCanvasArtifactExportDeps) {
  /**
   * The one export path for an authored object. The inspector's buttons, Brain's
   * `export` action, and the Files library all call this, so the file that lands
   * in Downloads, the deliverable recorded on the object, and the row the library
   * lists are produced once and cannot disagree.
   */
  const exportArtifact = useCallback(async (nodeId: string, action: CanvasExportAction): Promise<string> => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return t('exportFailed');
    // THE enforcement point for the export boundary. The button row hides the formats
    // for a restricted card, but the AI tool path and the drag-to-desktop path call this
    // directly with `defaultExportAction`, so the refusal has to live where the bytes are
    // written rather than where the buttons are drawn.
    if (!objectMayCross(target, 'export')) return t('exportRestricted');
    // The second gate, and a different question: confidentiality asks whether this CARD
    // may leave, the use policy asks whether these ROWS may be used this way. A dataset
    // classified as personal data and collected for one purpose does not become
    // exportable because somebody with edit rights clicked Download — the classification
    // has to be able to refuse, or it is documentation rather than governance.
    // `dataUse`, not `usePolicy`: the latter was never in `MUTABLE_FIELDS.dataset` and no
    // tool or importer ever wrote it, so this gate was reading `undefined` on every dataset
    // that has ever existed. See `dataGovernance.ts` for the merge that closed it.
    const useGate = evaluateDatasetUse('export', normalizeClassifications(target.data.classifications), normalizeUsePolicy(target.data.dataUse));
    if (!useGate.allowed) { setNotice(useGate.reason ?? t('exportRestricted')); return useGate.reason ?? t('exportRestricted'); }
    const markdown = canvasObjectMarkdown(target.data);
    const base = safeDownloadName(target.data.title);
    const exportRefusals = {
      noRows: () => new Error(t('noTabularRows')),
      unmasked: (columns: string[]) => new Error(t('exportUnmaskedColumns', { columns: columns.join(', ') })),
    };
    try {
      if (action === 'copy') return await copyTextToClipboard(markdown) ? t('copiedToClipboard') : t('clipboardUnavailable');
      const diagram = canvasDiagram(target.data);
      let fileName = `${base}.${EXPORT_EXTENSION[action as Exclude<CanvasExportAction, 'copy' | 'diagram'>] ?? 'md'}`;
      // Set only when the renderer refuses THIS caller — a guest out of daily
      // downloads. Decided by the attempt, not guessed from the session, because
      // a guest CAN render: the export surface takes a guest token.
      let degraded = false;
      // Set when the PDF was opened in a print dialog rather than downloaded, so
      // the deliverable records the provider that actually produced it.
      let printed = false;

      if (action === 'markdown') downloadText(markdown, fileName, 'text/markdown');
      if (action === 'html') {
        const renderedResume = target.data.kind === 'resume' ? renderedCanvasResume(target.data) : null;
        downloadText(renderedResume ? resumeHtmlFile(target.data.title, renderedResume) : markdownHtmlDocument(target.data.title, markdown), fileName, 'text/html');
      }
      if (action === 'csv') {
        const sheet = exportableSheet(target.data, exportRefusals);
        exportCsv(toCsv(sheet.columns, sheet.rows), fileName);
      }
      if (action === 'diagram') {
        if (!diagram) throw new Error(t('noDiagramSource'));
        // Extension and MIME come from the notation row, never from a guess:
        // a Mermaid diagram downloaded as `.drawio` is a file nothing opens.
        const notation = diagramNotation(diagram.format);
        if (!notation) throw new Error(t('noDiagramSource'));
        fileName = `${base}.${notation.extensions[0]}`;
        downloadText(diagram.source, fileName, notation.mimeType);
      }
      if (action === 'svg') {
        // The drawing that is ON the board, not a second rendering of its source.
        const svg = canvasObjectSvg(target.data, nodeId);
        if (!svg) throw new Error(t('noRenderedDrawing'));
        downloadText(svg, fileName, 'image/svg+xml');
      }
      if (SERVER_RENDERED_ACTIONS.has(action)) {
        const sheet = action === 'xlsx' ? exportableSheet(target.data, exportRefusals) : null;
        try {
          if (action === 'docx') {
            const renderedResume = target.data.kind === 'resume' ? renderedCanvasResume(target.data) : null;
            await exportDocx(markdown, target.data.title, {
              ...(renderedResume ? { theme: {
                accent: renderedResume.template.accent,
                font: renderedResume.template.font,
                density: renderedResume.template.density,
                columns: renderedResume.template.columns,
              } } : {}),
              // A document that arrived as a dropped .docx is EDITED, not
              // regenerated: its own package is reopened and the new body
              // written into it, so the file that comes back keeps the source's
              // theme, numbering and section layout. See exportApi.
              ...(typeof target.data.sourceFileKey === 'string' ? { sourceFileKey: target.data.sourceFileKey } : {}),
            });
          }
          if (action === 'pptx') await exportPptx(markdown, target.data.title);
          if (action === 'xlsx') await exportXlsx(sheet!.columns, sheet!.rows, target.data.title);
        } catch (error) {
          // Only a credential/allowance refusal degrades. A malformed payload or
          // a render fault is a real failure and must surface as one.
          if (!(error instanceof OfficeExportUnavailableError)) throw error;
          degraded = true;
          fileName = `${base}.${action === 'xlsx' ? 'csv' : 'md'}`;
          if (action === 'xlsx') exportCsv(toCsv(sheet!.columns, sheet!.rows), fileName);
          else downloadText(markdown, fileName, 'text/markdown');
        }
      }
      if (action === 'pdf') {
        // A picture or a paged visual layout is DRAWN, so it goes through the
        // browser's print pipeline — that is the only thing that can render what
        // is on the board. A document is WRITTEN, so `/api/exports/pdf` produces
        // the bytes: a print dialog is not an export, because it needs a human at
        // a keyboard and gives each browser a different file.
        if (pdfExportStrategy(target.data.kind) === 'print') {
          if (!printCanvasObject(target.data, canvasObjectSvg(target.data, nodeId))) throw new Error(t('printUnavailable'));
          printed = true;
        } else {
          try {
            await exportPdf(markdown, target.data.title, { footer: target.data.title });
          } catch (error) {
            // Same rule as the Office renderers: only a credential/allowance
            // refusal degrades — and here the degrade is the print pipeline,
            // which still puts a PDF in the visitor's hands.
            if (!(error instanceof OfficeExportUnavailableError)) throw error;
            if (!printCanvasObject(target.data, canvasObjectSvg(target.data, nodeId))) throw new Error(t('printUnavailable'));
            printed = true;
          }
        }
      }
      if (action === 'spec') {
        // The runnable file the whole "write me tests" request was for. A plan
        // exports every case connected to it as ONE spec file, because that is how
        // someone actually takes a suite away — not one download per card.
        const source = canvasSpecSource(target, nodes, edges);
        if (!source) throw new Error(t('noGeneratedSpec'));
        downloadText(source, fileName, EXPORT_MIME.spec);
      }
      if (action === 'json') {
        // A test plan's JSON is its RELEASE EVIDENCE, not a dump of its node data —
        // the exact shape `qa-e2e/src/canvas-release-audit.ts` audits. That is what
        // turns the gate from "whatever someone typed into a file" into the runs and
        // defects that are actually on the board. Every other kind exports itself.
        const evidence = target.data.kind === 'testPlan'
          ? releaseEvidence(
            { title: target.data.title, targetUrl: String(target.data.targetUrl ?? ''), exitCriteria: normalizeExitCriteria(target.data.exitCriteria) },
            releaseGateEvidence(target, nodes, edges),
            new Date().toISOString(),
          )
          : { kind: target.data.kind, title: target.data.title, data: target.data };
        downloadJson(evidence, fileName);
      }
      if (action === 'scorm') downloadBlob(new Blob([buildScormPackage(courseFromNode(target.data), target.data.title)], { type: EXPORT_MIME.scorm }), fileName);

      const delivered: CreationDeliverable = {
        id: crypto.randomUUID(), action: 'export', artifactKind: action, status: 'delivered',
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        provider: degraded ? 'browser-office-fallback'
          : printed ? 'browser-print'
          : SERVER_RENDERED_ACTIONS.has(action) || action === 'pdf' ? 'builderforce-office-export'
          : 'browser-download',
        fileName,
        mimeType: action === 'diagram'
          ? (diagram?.format === 'mermaid' ? 'text/vnd.mermaid' : 'application/vnd.jgraph.mxfile')
          : degraded ? (action === 'xlsx' ? EXPORT_MIME.csv : EXPORT_MIME.markdown) : EXPORT_MIME[action],
        validation: { status: 'passed', detail: 'Export generated and download started' },
      };
      setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      if (printed) return t('printOpened');
      // A guest session cannot reach the authenticated Office renderer, so say
      // what actually landed in Downloads and point at the export that DOES work
      // there, rather than reporting a Word file that was never produced.
      return degraded ? (action === 'xlsx' ? t('csvDownloadedSignInForExcel') : t('markdownDownloadedUsePdf')) : t('downloadReady');
    } catch (error) {
      return error instanceof Error ? error.message : t('exportFailed');
    }
  }, [edges, nodes, setNodes, setNotice, t]);
  return { exportArtifact };
}
