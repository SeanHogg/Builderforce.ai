/**
 * The ONE context every inline Brain tool on the canvas is built against.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The canvas's tools used to be one `useMemo` of ~4 400 lines inside `CanvasInner`,
 * and that memo listed `nodes`, `edges`, the scope and the selection among its
 * dependencies — plus `stageImageAsset`, a plain function re-created every render.
 * So the whole vocabulary (68 tools) was rebuilt on EVERY render, and with it every
 * consumer keyed on the action list. Tools are called at turn time, never during
 * render, so nothing in them needs to be a dependency: they need to read the
 * CURRENT board when they run.
 *
 * So the context is split by how often each part changes:
 *  - STABLE inputs (`stage`, the translators, the session, role) are plain fields,
 *    and they are the only things the memo that builds the tools depends on;
 *  - LIVE inputs (the board, the scope, the selection, and the `CanvasInner`
 *    callbacks that close over them) are read through ONE ref the component
 *    refreshes each render — the same treatment `nodesRef` and `layoutViewportRef`
 *    already give the proposal stage, for the same reason.
 *
 * The domain modules beside this file (`executive.ts`, `dataQuery.ts`, …) are pure
 * factories over this context: no React, no closure over component state.
 */
import type { RefObject } from 'react';
import type { useTranslations } from 'next-intl';
import type { Formatter } from '@/i18n/format';
import type { CanvasActionKind } from '@/lib/canvasActionJournal';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { useCanvasLayoutViewport } from '@/components/canvas/useCanvasLayoutViewport';
import { tabularFromObject } from '@/lib/canvasTabularData';
import type { CanvasImageAsset } from '@/lib/canvasImageAssets';
import { withCreationDeliverable, type CreationDeliverable } from '@/lib/creationDeliverables';
import type { socialApi, SocialFeedFilter } from '@/lib/socialApi';
import { C_SUITE_CANVAS_USE_CASES, cSuiteCanvasWorkflow, executiveRequiredTools, missingRequiredTools } from '@/lib/templates/promptUseCases';
import type { CanvasDockPanel } from '../CanvasBoardMenuBody';
import type { CreationFlowNode } from '../CreationNode';
import { safeDownloadName } from '../canvasArtifactExport';
import type { CreationNodeData, CreationObjectKind } from '../types';

export type CanvasActionTranslator = ReturnType<typeof useTranslations<'creationCanvas'>>;
export type CanvasSocialTranslator = ReturnType<typeof useTranslations<'creationCanvas.social'>>;
export type CanvasScopeMode = 'canvas' | 'selection' | 'connected' | 'frame';
export type CanvasAccountGateResult = { requiresAccount: true; tool: string; error: string };
export type CanvasJournalEvidence = { at: string; kind: CanvasActionKind; label: string; detail?: string; ok?: boolean; durationMs?: number };
type SocialFeedRead = Awaited<ReturnType<typeof socialApi.feed>>;

/** What the canvas reads LIVE — refreshed every render, never a memo dependency. */
export interface CanvasActionLive {
  nodes: CreationFlowNode[];
  scopedNodeIds: Set<string>;
  resolvedScopeMode: CanvasScopeMode;
  effectiveSelectedIds: string[];
  requireAccount: (action: string, title: string, description: string) => void;
  openAccountGate: (tool: string, action: string, title: string, description: string, reason: string) => CanvasAccountGateResult;
  socialAccountGate: (tool: string) => CanvasAccountGateResult | null;
  buildSocialFeedNode: (
    filter: SocialFeedFilter,
    opts?: { title?: string; x?: number; y?: number },
  ) => Promise<{ ok: true; node: CreationFlowNode; read: SocialFeedRead } | { ok: false; error: string }>;
  convertObjectToDiagram: (sourceId: string, requestedFormat?: string, requestedDiagramId?: string) => Promise<{ ok: boolean; diagramId?: string; error?: string }>;
  localizedTourDefaults: () => Partial<CreationNodeData>;
  recentJournalEvidence: (limit?: number) => CanvasJournalEvidence[];
}

/** What the canvas hands in ONCE per session/role/locale. */
export interface CanvasActionStable {
  sessionId: string;
  persistence: 'local' | 'server';
  canEdit: boolean;
  t: CanvasActionTranslator;
  tSocial: CanvasSocialTranslator;
  fmt: Formatter;
  stage: CanvasProposalStage;
  setDockPanel: (panel: CanvasDockPanel | null) => void;
  promptRef: RefObject<string>;
  layoutViewportRef: RefObject<ReturnType<typeof useCanvasLayoutViewport>>;
  /** The executive use case this turn is running, if any — see `measurementGate`. */
  inFlightUseCaseIdRef: RefObject<string | null>;
  /** Tools called so far this turn. */
  turnToolCallsRef: RefObject<Set<string>>;
}

export interface CanvasActionContext extends CanvasActionStable, Omit<CanvasActionLive, 'nodes' | 'scopedNodeIds' | 'resolvedScopeMode' | 'effectiveSelectedIds'> {
  /** The committed board as of the last render. */
  nodes(): CreationFlowNode[];
  scopedNodeIds(): Set<string>;
  resolvedScopeMode(): CanvasScopeMode;
  effectiveSelectedIds(): string[];
  stageImageAsset(asset: CanvasImageAsset, options: { title: string; prompt?: string; at?: { x?: number; y?: number } }): CreationFlowNode;
  resolveTabularTarget(objectId?: string): ReturnType<typeof resolveTabularTarget>;
  measurementGate(kind: CreationObjectKind): { error: string } | null;
}

/**
 * Build the context once per stable input set. Every live member forwards through
 * `liveRef`, so a tool always reads the board as it is when the tool RUNS.
 */
export function createCanvasActionContext(stable: CanvasActionStable, liveRef: RefObject<CanvasActionLive>): CanvasActionContext {
  return {
    ...stable,
    nodes: () => liveRef.current.nodes,
    scopedNodeIds: () => liveRef.current.scopedNodeIds,
    resolvedScopeMode: () => liveRef.current.resolvedScopeMode,
    effectiveSelectedIds: () => liveRef.current.effectiveSelectedIds,
    requireAccount: (...args) => liveRef.current.requireAccount(...args),
    openAccountGate: (...args) => liveRef.current.openAccountGate(...args),
    socialAccountGate: (...args) => liveRef.current.socialAccountGate(...args),
    buildSocialFeedNode: (...args) => liveRef.current.buildSocialFeedNode(...args),
    convertObjectToDiagram: (...args) => liveRef.current.convertObjectToDiagram(...args),
    localizedTourDefaults: () => liveRef.current.localizedTourDefaults(),
    recentJournalEvidence: (...args) => liveRef.current.recentJournalEvidence(...args),
    stageImageAsset: (asset, options) => stageImageAsset(stable, asset, options),
    resolveTabularTarget: (objectId) => resolveTabularTarget(stable.stage, objectId),
    measurementGate: (kind) => measurementGate(stable, kind),
  };
}

/**
 * Stage ONE resolved image asset as an `image` object — the single place a picture
 * becomes a canvas node.
 *
 * Extracted when live-page CAPTURE arrived. `canvas_add_image` had authored this
 * inline: the node, the mime/extension sniff, the download name, the deliverable
 * ledger entry and the proposal label, ~35 lines of it. `canvas_capture_screenshot`
 * needs every one of those to be identical — a captured "before" that lands with no
 * deliverable is a picture the export, the print document and the marketplace listing
 * all silently drop — so the choice was one helper or two copies that drift.
 *
 * Source is DATA here rather than a branch at each call site: `stock`, `ai` and
 * `capture` differ only in what they put in the subtitle, the status and the
 * validation note.
 */
function stageImageAsset(
  { stage, t }: Pick<CanvasActionStable, 'stage' | 't'>,
  asset: CanvasImageAsset,
  options: { title: string; prompt?: string; at?: { x?: number; y?: number } },
): CreationFlowNode {
  const node = stage.createObject('image', options.at ?? {});
  const mimeType = asset.url.startsWith('data:image/png') || /\.png(?:$|[?#])/i.test(asset.url) ? 'image/png'
    : asset.url.startsWith('data:image/webp') || /\.webp(?:$|[?#])/i.test(asset.url) ? 'image/webp' : 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const delivered: CreationDeliverable = {
    id: crypto.randomUUID(),
    action: asset.source === 'stock' ? 'find' : asset.source === 'capture' ? 'capture' : 'generate',
    artifactKind: 'image',
    status: 'delivered', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    url: asset.url, mimeType, fileName: `${safeDownloadName(options.title)}.${extension}`, provider: asset.provider,
    validation: {
      status: 'passed',
      detail: asset.source === 'stock' ? t('imageFoundValidation', { provider: asset.licence ?? asset.provider })
        : asset.source === 'capture' ? t('imageCapturedValidation', { url: asset.capturedUrl ?? '' })
        : t('imageGeneratedValidation'),
    },
    metadata: { source: asset.source, ...(asset.model ? { model: asset.model } : {}) },
  };
  node.data = {
    ...node.data,
    title: options.title,
    subtitle: asset.source === 'stock' ? `${asset.licence ?? asset.provider}${asset.author ? ` · ${asset.author}` : ''}`
      : asset.source === 'capture' ? (asset.capturedUrl ?? '')
      : (options.prompt ?? ''),
    status: asset.source === 'stock' ? t('imageFoundStatus')
      : asset.source === 'capture' ? t('imageCapturedStatus')
      : t('creativeGeneratedStatus'),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    outputUrl: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
    outputFormat: 'Image',
    outputFileName: delivered.fileName,
    outputMimeType: mimeType,
    provider: asset.provider,
    ...(asset.model ? { model: asset.model } : {}),
    ...(asset.width ? { imageWidth: asset.width } : {}),
    ...(asset.height ? { imageHeight: asset.height } : {}),
    imageSource: asset.source,
    imageLicence: asset.licence,
    imageAuthor: asset.author,
    imageAuthorUrl: asset.authorUrl,
    // A capture is EVIDENCE, so it carries what it is of and when. Without these the
    // board holds a screenshot nobody can date or attribute to a page.
    ...(asset.capturedUrl ? { capturedUrl: asset.capturedUrl, url: asset.capturedUrl } : {}),
    ...(asset.capturedAt ? { capturedAt: asset.capturedAt } : {}),
    ...(asset.capturedViewport ? { viewport: asset.capturedViewport } : {}),
    deliverables: withCreationDeliverable(node.data, delivered),
  };
  node.style = { width: 520, height: 430 };
  stage.addObject(t(asset.source === 'stock' ? 'imageFoundProposal' : asset.source === 'capture' ? 'imageCapturedProposal' : 'imageGeneratedProposal', { title: node.data.title }), node);
  return node;
}

/**
 * Resolve "the dataset this action runs against", once.
 *
 * Five data tools ask the same question — classify, contract, quality, metric,
 * and the model inferrer — and each was a candidate to re-derive the candidate
 * list, the ambiguity error and the empty-rows error slightly differently. It
 * reads STAGED objects too, so a dataset proposed earlier in the same turn can
 * be classified in the next tool call rather than being reported as absent.
 */
function resolveTabularTarget(stage: CanvasProposalStage, objectId?: string) {
  const candidates = stage.nodes().filter((node) =>
    ['dataset', 'table', 'spreadsheet', 'datasource'].includes(node.data.kind)
    && Array.isArray(node.data.rows) && node.data.rows.length > 0);
  const node = objectId ? candidates.find((candidate) => candidate.id === objectId) : candidates.length === 1 ? candidates[0] : undefined;
  if (!node) {
    return {
      error: candidates.length
        ? `Specify which dataset. Tabular objects on this canvas: ${candidates.map((candidate) => `${candidate.id} (${candidate.data.title})`).join(', ')}`
        : 'No dataset with imported rows is on this canvas. Attach a CSV, TSV, or JSON file, or read one from a connected data source with canvas_query_data_source.',
    } as const;
  }
  const source = tabularFromObject(node.data as Record<string, unknown>);
  if (!source.columns.length) return { error: `${node.data.title} has no columns yet.` } as const;
  return { node, source } as const;
}

/**
 * The measurement gate: refuse to author a use case's OWN output until the tool that
 * measures it has run.
 *
 * ── WHY IT LIVES AT THE AUTHORING BOUNDARY ──────────────────────────────────────
 * The requirement could have been checked in `canvas_prepare_executive_use_case`,
 * and that would enforce nothing: preparation runs FIRST, before any tool has been
 * called, so the only honest answer there is to describe the requirement. It could
 * have been checked when the turn ends, which is worse — the card is already on the
 * board by then and the only remaining move is to delete somebody's work.
 *
 * So it is checked where the fabricated number would actually land. `career.job.assess`
 * declares `builtin_recruiter_match_job`; until that has run this turn, `canvas_add_object`
 * refuses `kind: 'job'` and names the tool. A model that reasoned its way to "82% match"
 * cannot write it onto a card, and the refusal tells it exactly how to get a real one.
 *
 * SCOPED to the use case's declared outputs, deliberately. A turn running
 * `career.job.assess` may still add a `note`, a `document` or a `task` freely — the gate
 * exists to stop an unmeasured ANSWER, not to stop the board being used while a
 * measurement is pending.
 */
function measurementGate(
  { inFlightUseCaseIdRef, turnToolCallsRef }: Pick<CanvasActionStable, 'inFlightUseCaseIdRef' | 'turnToolCallsRef'>,
  kind: CreationObjectKind,
): { error: string } | null {
  const useCase = C_SUITE_CANVAS_USE_CASES.find((candidate) => candidate.id === inFlightUseCaseIdRef.current);
  if (!useCase) return null;
  const required = executiveRequiredTools(useCase);
  if (!required.length) return null;
  const workflow = cSuiteCanvasWorkflow(useCase);
  if (!workflow?.outputs.includes(kind)) return null;
  const missing = missingRequiredTools(required, turnToolCallsRef.current);
  if (!missing.length) return null;
  return {
    error: `\`${kind}\` is the answer to ${useCase.id}, and that answer must be MEASURED. Call ${missing.join(' and ')} first, then author this object from what it returns. Do not infer the numbers from the documents already in context — a score produced that way changes every time it is asked for, which is the reason this tool exists.`,
  };
}
