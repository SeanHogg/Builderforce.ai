/** Files and host captures arriving on the board — dropped, pasted, attached or captured. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import { TEAMMATE_JOIN_EVENT, type TeammatePayload } from '@/lib/team/teammate';
import { type CanvasHostCapture, canvasSurface } from '@/lib/canvasHost';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { IMPORT_COLUMN_GAP, IMPORT_ROW_GAP, MAX_DROPPED_FILES, nextPaint } from '../canvasFileDrop';
import { newNode } from '../canvasNodeHelpers';
import { type AttachmentBytesStrategy, importCanvasFile } from '@/domains/canvas/application/ImportCanvasFile';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { trackActivity } from '@/lib/activity/tracker';
import type { useTranslations } from 'next-intl';
import type { Edge, ReactFlowInstance } from '@xyflow/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CreationFlowNode } from '../CreationNode';
import type { CanvasJournal } from '@/lib/canvasActionJournal';

export interface UseCanvasFileIntakeDeps {
  addAtCenter: (kind: CreationObjectKind, data?: Partial<CreationNodeData>, size?: { width: number; height: number; }) => void;
  attachmentBytesStrategy: AttachmentBytesStrategy;
  canEdit: boolean;
  flowRef: RefObject<ReactFlowInstance<CanvasObject, Edge> | null>;
  importLabel: CanvasTextTranslator;
  journal: RefObject<CanvasJournal>;
  openBrainDock: () => void;
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  seatTeammate: (teammate: TeammatePayload, point?: { x: number; y: number; }) => void;
  sessionId: string;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  stageActive: boolean;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

export function useCanvasFileIntake({ addAtCenter, attachmentBytesStrategy, canEdit, flowRef, importLabel, journal, openBrainDock, placeAppendedRef, seatTeammate, sessionId, setNodes, setNotice, setPrompt, setSelectedId, setSelectedIds, stageActive, t }: UseCanvasFileIntakeDeps) {
  // The keyboard half of §3.3. Only the board actually on the stage answers —
  // hidden cached boards hear the same event and must not quietly seat someone
  // on a canvas nobody is looking at.
  useEffect(() => {
    if (!stageActive) return undefined;
    const onJoin = (event: Event) => {
      const detail = (event as CustomEvent<TeammatePayload>).detail;
      if (detail) seatTeammate(detail);
    };
    window.addEventListener(TEAMMATE_JOIN_EVENT, onJoin);
    return () => window.removeEventListener(TEAMMATE_JOIN_EVENT, onJoin);
  }, [seatTeammate, stageActive]);

  /** Place an object the EDITOR captured (active file, selection, problems, …). */
  const addHostCapture = useCallback((capture: CanvasHostCapture) => {
    addAtCenter(capture.kind, { title: capture.title, ...capture.content } as Partial<CreationNodeData>);
  }, [addAtCenter]);

  /**
   * Files arriving from anywhere — dropped from the desktop, attached in the
   * composer — become the objects they actually are: a Word file opens as a
   * document with pages, a workbook as a sheet per tab, a deck as slides, a
   * data export as a queryable Dataset. The board is the creative starting
   * space, so the drop also puts the first question in the composer and opens
   * Brain: a file that lands here starts a conversation, it does not just sit
   * there as an icon.
   */
  const addFilesToCanvas = useCallback(async (files: File[], origin?: { x: number; y: number }, source = 'canvas_drop') => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    if (!files.length) return;
    const start = origin ?? flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const accepted = files.slice(0, MAX_DROPPED_FILES);

    /**
     * Every dropped file gets a card BEFORE anything is read.
     *
     * The readers are synchronous CPU wearing an async signature, so a 40MB PDF
     * seizes the main thread for seconds. Creating the nodes only after the parse
     * meant the drop overlay vanished on release and the canvas then showed
     * nothing at all until the last of twelve files finished — indistinguishable
     * from a drop that failed. The card is the receipt.
     */
    const stubs = accepted.map((file, index) => {
      const node = newNode('file', { x: start.x + index * IMPORT_COLUMN_GAP, y: start.y });
      node.data = {
        ...node.data,
        title: file.name,
        fileName: file.name,
        fileSize: file.size,
        status: importLabel('statusImporting'),
        importPending: true,
      } as CreationNodeData;
      return node;
    });
    setNodes((current) => [...current, ...placeAppendedRef.current(current, stubs)]);
    setSelectedId(stubs[0]!.id);
    setSelectedIds(stubs.map((node) => node.id));
    openBrainDock();
    await nextPaint();

    const notices: string[] = [];
    const objectKinds: string[] = [];
    let suggestion = '';
    for (const [index, file] of accepted.entries()) {
      const stub = stubs[index]!;
      // Dropping four files and getting four cards is the moment a person stops
      // being able to explain what happened — so the journal records each one,
      // with the kind it BECAME. "guide.htm → attachment" is the single line that
      // explains why the agent could not read it.
      const importDone = journal.current.begin('user', 'file.import', `${file.name} · ${Math.max(1, Math.round(file.size / 1024))}KB`);
      try {
        const imported = await importCanvasFile(file, importLabel, attachmentBytesStrategy);
        const [first, ...rest] = imported.objects;
        if (!first) throw new Error('The file produced no object');
        importDone({ ok: true, detail: `→ ${imported.objects.map((object) => object.kind).join(', ')}` });
        // The stub BECOMES the artifact — same id, same position — so the card a
        // person is already looking at fills in rather than being replaced by a
        // second one somewhere else on the board.
        const resolved = newNode(first.kind, stub.position);
        // A workbook yields one object per sheet; the extras stack under the
        // card that stood in for the file.
        const extras = rest.map((object, offset) => {
          const node = newNode(object.kind, { x: stub.position.x, y: stub.position.y + (offset + 1) * IMPORT_ROW_GAP });
          node.data = { ...node.data, ...object.data } as CreationNodeData;
          return node;
        });
        setNodes((current) => [
          ...current.map((node) => node.id === stub.id
            ? { ...node, data: { ...resolved.data, ...first.data, importPending: false } as CreationNodeData }
            : node),
          ...extras,
        ]);
        objectKinds.push(first.kind, ...rest.map((object) => object.kind));
        notices.push(imported.notice);
        if (!suggestion) suggestion = imported.suggestedPrompt;
      } catch (error) {
        importDone({ ok: false, detail: `unreadable — ${toolErrorMessage(error, 'import failed')}` });
        setNodes((current) => current.map((node) => node.id === stub.id
          ? { ...node, data: { ...node.data, status: importLabel('statusUnreadable'), importPending: false } as CreationNodeData }
          : node));
        notices.push(importLabel('failed', { name: file.name }));
      }
      // Each file's result paints before the next one takes the thread back.
      await nextPaint();
    }
    if (files.length > MAX_DROPPED_FILES) notices.push(importLabel('tooManyFiles', { limit: MAX_DROPPED_FILES }));
    setNotice(notices.join(' · '));
    // Never overwrite something the person is part-way through typing.
    if (suggestion) setPrompt((current) => current.trim() ? current : suggestion);
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: canvasSurface(), objectKinds, source } });
  }, [attachmentBytesStrategy, canEdit, importLabel, openBrainDock, sessionId, setNodes, t]);

  const attachCanvasArtifact = useCallback(
    (file: File) => addFilesToCanvas([file], undefined, 'composer_attachment'),
    [addFilesToCanvas],
  );
  return { addFilesToCanvas, attachCanvasArtifact, addHostCapture };
}
