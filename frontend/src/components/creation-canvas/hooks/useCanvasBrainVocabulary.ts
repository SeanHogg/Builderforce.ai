/** The Brain's tool vocabulary for this board — the inline actions plus every tool-module family, built once per session/role/locale. */
import { type Dispatch, type RefObject, type SetStateAction, useLayoutEffect, useMemo, useRef } from 'react';
import { canvasBuildActions } from '@/lib/canvasBuildTools';
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { notifyWorkspaceFilesChanged } from '@/lib/workspaceFileEvents';
import { canvasFounderOpsActions, type CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import type { CreationNodeData, CreationObjectKind } from '../types';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { canvasEquityActions } from '@/lib/canvasEquityTools';
import { canvasHiringPostingActions } from '@/lib/canvasHiringPostingTools';
import { canvasDataRoomActions } from '@/lib/canvasDataRoomTools';
import { canvasDocumentTemplateActions } from '@/lib/canvasDocumentTemplateTools';
import { canvasLegalDocumentActions } from '@/lib/canvasLegalDocumentTools';
import { canvasLegalRecordActions } from '@/lib/canvasLegalRecordTools';
import { canvasSignatureActions } from '@/lib/canvasSignatureTools';
import { canvasSellMotionActions } from '@/lib/canvasSellMotionTools';
import { canvasPromptLibraryActions } from '@/lib/canvasPromptLibraryTools';
import { type CanvasActionLive, createCanvasActionContext } from '../actions/context';
import { canvasInlineActions } from '../actions';
import { canvasToolRequiresAccount } from '@builderforce/creation-canvas-contract';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CreationFlowNode } from '../CreationNode';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { socialApi, SocialFeedFilter } from '@/lib/socialApi';
import type { CanvasActionKind } from '@/lib/canvasActionJournal';
import type { useTranslations } from 'next-intl';
import type { Formatter } from '@/i18n/format';
import type { CanvasDockPanel } from '../CanvasBoardMenuBody';
import type { CanvasSessionAppActions } from './useCanvasSessionApp';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';

export interface UseCanvasBrainVocabularyDeps {
  buildsRef: CanvasSessionAppActions['buildsRef'];
  createApp: CanvasSessionAppActions['createApp'];
  buildSocialFeedNode: (filter: SocialFeedFilter, opts?: { title?: string; x?: number; y?: number; }) => Promise<{ ok: true; node: CreationFlowNode; read: Awaited<ReturnType<typeof socialApi.feed>>; } | { ok: false; error: string; }>;
  canEdit: boolean;
  canvasText: CanvasTextTranslator;
  convertObjectToDiagram: (sourceId: string, requestedFormat?: string, requestedDiagramId?: string) => Promise<{ ok: boolean; diagramId?: string; error?: string; }>;
  effectiveSelectedIds: string[];
  fmt: Formatter;
  inFlightUseCaseId: RefObject<string | null>;
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>;
  localizedTourDefaults: () => Partial<CreationNodeData>;
  nodes: CanvasObject[];
  nodesRef: RefObject<CanvasObject[]>;
  openAccountGate: (tool: string, action: string, title: string, description: string, reason: string) => { requiresAccount: true; tool: string; error: string; };
  persistence: 'local' | 'server';
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  promptRef: RefObject<string>;
  recentJournalEvidence: (limit?: number) => { durationMs?: number | undefined; ok?: boolean | undefined; detail?: string | undefined; at: string; kind: CanvasActionKind; label: string; }[];
  requireAccount: (action: string, title: string, description: string) => void;
  resolvedScopeMode: 'frame' | 'selection' | 'canvas' | 'connected';
  scopedNodeIds: Set<string>;
  sessionId: string;
  setDockPanel: Dispatch<SetStateAction<CanvasDockPanel | null>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  socialAccountGate: (tool: string) => { requiresAccount: true; tool: string; error: string; } | null;
  stage: CanvasProposalStage;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  tSocial: ReturnType<typeof useTranslations<'creationCanvas.social'>>;
  turnToolCalls: RefObject<Set<string>>;
}

export function useCanvasBrainVocabulary({ buildsRef, createApp, buildSocialFeedNode, canEdit, canvasText, convertObjectToDiagram, effectiveSelectedIds, fmt, inFlightUseCaseId, layoutViewportRef, localizedTourDefaults, nodes, nodesRef, openAccountGate, persistence, placeAppendedRef, promptRef, recentJournalEvidence, requireAccount, resolvedScopeMode, scopedNodeIds, sessionId, setDockPanel, setNodes, socialAccountGate, stage, t, tSocial, turnToolCalls }: UseCanvasBrainVocabularyDeps) {
  /**
   * The BUILD vocabulary — creating and editing the code behind a Builder object.
   *
   * The apps are the session's (`useCanvasSessionApp`): `buildsRef` is read by the tools at
   * call time, so adding an object to the board never re-registers them, and `createApp`
   * gives a guest board a browser-held workspace instead of refusing.
   */
  const canvasBuildActionList = useMemo<BrainAction[]>(() => canvasBuildActions({
    builds: () => buildsRef.current ?? [],
    createBuild: createApp,
    onFilesChanged: notifyWorkspaceFilesChanged,
  }), [buildsRef, createApp]);

  /**
   * The context every board-mutation AI tool GROUP shares — founder-ops, legal
   * documents, and the generic e-signature tool all stage proposals against the
   * SAME board through the SAME three primitives (read objects, stage an add, stage
   * an update), so they read one context rather than three copies of the same three
   * closures. `CanvasFounderOpsContext` is generic enough for all three; a second,
   * near-identical interface would be exactly the duplication this consolidation
   * exists to avoid.
   *
   * Staged as PROPOSALS like every other authoring tool (unlike the build tools
   * above, which commit): nothing here provisions a durable resource that a
   * rejected proposal would orphan. `canvas_move_deal` is the exception worth
   * naming — it writes a real deal — but the write it performs is in the CRM and
   * is the user's stated intent; what gets staged is the board's redraw of it.
   */
  const canvasOpsContext = useMemo<CanvasFounderOpsContext>(() => ({
    sessionId,
    hasTenant: persistence === 'server',
    canEdit,
    t: canvasText,
    objects: () => {
      return stage.nodes().map((node) => ({
        id: node.id, kind: node.data.kind, title: node.data.title,
        data: node.data as unknown as Record<string, unknown>,
      }));
    },
    addObject: (kind, fields, at) => {
      const node = stage.createObject(kind as CreationObjectKind, at ?? {});
      node.data = { ...node.data, ...sanitizeCreationObjectPatch(kind as CreationObjectKind, fields) } as CreationNodeData;
      stage.addObject(String(fields.title ?? node.data.title), node);
      return { objectId: node.id };
    },
    updateObject: (objectId, patch, label) => {
      const kind = nodesRef.current.find((node) => node.id === objectId)?.data.kind;
      stage.updateObject(label, objectId, sanitizeCreationObjectPatch((kind ?? 'account') as CreationObjectKind, patch));
    },
  }), [canEdit, canvasText, persistence, sessionId, stage]);

  const canvasFounderOpsActionList = useMemo<BrainAction[]>(() => canvasFounderOpsActions(canvasOpsContext), [canvasOpsContext]);
  /** Ownership — fold the cap table, record a grant or a convertible, append a ledger
   *  event, model a round. See `canvasEquityTools.ts` for why there is deliberately no
   *  tool that WRITES a cap table. */
  const canvasEquityActionList = useMemo<BrainAction[]>(() => canvasEquityActions(canvasOpsContext), [canvasOpsContext]);
  /** The requisition, bound to its real `job_postings` row so `applicantCount` is a
   *  COUNT and not a typed number (FO-B3). See `canvasHiringPostingTools.ts` for why one
   *  tool covers both directions, and why it will not resolve a card by title. */
  const canvasHiringPostingActionList = useMemo<BrainAction[]>(() => canvasHiringPostingActions(canvasOpsContext), [canvasOpsContext]);
  /** The secure legal-document vocabulary — share, revoke, request signature, sync.
   *  See `canvasLegalDocumentTools.ts` for why these are dedicated tools rather than
   *  routed through `canvas_invoke_object_action`. */
  /** The data room, actually sent — sync it, share it with one named firm behind an
   *  NDA, revoke that firm's access. The three columns `data_rooms` has always carried
   *  and nothing ever read (FO-E2). */
  const canvasDataRoomActionList = useMemo<BrainAction[]>(() => canvasDataRoomActions(canvasOpsContext), [canvasOpsContext]);
  /** The founders' agreement and its siblings, drafted from the ONE template registry
   *  onto a `contract` card — then signed through the signature tool that already
   *  existed, so there is no second signature path (FO-D5). */
  const canvasDocumentTemplateActionList = useMemo<BrainAction[]>(() => canvasDocumentTemplateActions(canvasOpsContext), [canvasOpsContext]);
  const canvasLegalDocumentActionList = useMemo<BrainAction[]>(() => canvasLegalDocumentActions(canvasOpsContext), [canvasOpsContext]);
  /** The legal seat's own RECORDS — the entity, the IP asset, the matter — projected
   *  onto the board from `getEntityRows('legal', …)`. See `canvasLegalRecordTools.ts`
   *  for why one tool covers three kinds and why none of it is gated. */
  const canvasLegalRecordActionList = useMemo<BrainAction[]>(() => canvasLegalRecordActions(canvasOpsContext), [canvasOpsContext]);
  /** The generic e-signature request for authored (non-file) objects — closes the
   *  `contract.sign` gap; see `canvasSignatureTools.ts`. */
  const canvasSignatureActionList = useMemo<BrainAction[]>(() => canvasSignatureActions(canvasOpsContext), [canvasOpsContext]);
  /** The commercial half of the motion — share a board or a card with a prospect, read
   *  what they did with it, price a quote, read a call, assemble a trust packet, provision
   *  a trial, hand the board off, and drive a cadence. See `canvasSellMotionTools.ts` for
   *  why none of them can accept a quote. */
  const canvasSellMotionActionList = useMemo<BrainAction[]>(() => canvasSellMotionActions(canvasOpsContext), [canvasOpsContext]);
  /** Prompt iteration — read a library prompt with its versions, save the next one. See `canvasPromptLibraryTools.ts`. */
  const canvasPromptLibraryActionList = useMemo<BrainAction[]>(() => canvasPromptLibraryActions(canvasOpsContext), [canvasOpsContext]);

  /**
   * The inline Brain vocabulary — see `actions/context.ts`. `actionLive` is refreshed
   * after every commit (a layout effect, not a render-time write), so a tool reads the board as it is when it RUNS; `actionContext`, and
   * with it every tool, is rebuilt only when the session, role or locale changes. Before
   * this the vocabulary was one memo that depended on `nodes`, the scope and a function
   * re-created every render, so all of it was rebuilt on every render.
   */
  const actionLive = useRef<CanvasActionLive>(null!);
  useLayoutEffect(() => {
    actionLive.current = {
      nodes, scopedNodeIds, resolvedScopeMode, effectiveSelectedIds,
      requireAccount, openAccountGate, socialAccountGate, buildSocialFeedNode, convertObjectToDiagram, localizedTourDefaults, recentJournalEvidence,
    };
  });
  const actionContext = useMemo(() => createCanvasActionContext({
    sessionId, persistence, canEdit, t, tSocial, fmt, stage, setDockPanel, promptRef, layoutViewportRef, inFlightUseCaseId, turnToolCalls,
  }, actionLive), [canEdit, fmt, persistence, sessionId, stage, t, tSocial]);
  const canvasActions = useMemo<BrainAction[]>(() => ([...canvasInlineActions(actionContext), ...canvasBuildActionList, ...canvasFounderOpsActionList, ...canvasEquityActionList, ...canvasHiringPostingActionList, ...canvasDataRoomActionList, ...canvasDocumentTemplateActionList, ...canvasLegalDocumentActionList, ...canvasLegalRecordActionList, ...canvasSignatureActionList, ...canvasSellMotionActionList, ...canvasPromptLibraryActionList].filter((action) => persistence === 'server' || !canvasToolRequiresAccount(action.name))),
  [actionContext, canvasBuildActionList, canvasFounderOpsActionList, canvasEquityActionList, canvasHiringPostingActionList, canvasDataRoomActionList, canvasDocumentTemplateActionList, canvasLegalDocumentActionList, canvasLegalRecordActionList, canvasSignatureActionList, canvasSellMotionActionList, canvasPromptLibraryActionList, persistence]);
  return { canvasActions };
}
