/** Bringing connected-account content onto the board — social feeds and campaigns, Miro boards, board media. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { accountGateResult } from '../actions/accountGate';
import { CANVAS_SOCIAL_ACCOUNT_GATE } from '@builderforce/creation-canvas-contract';
import { describeSocialFilter, socialApi, type SocialCampaign, type SocialFeedFilter } from '@/lib/socialApi';
import type { CreationFlowNode } from '../CreationNode';
import { socialCampaignNodeData, socialFeedPatch } from '@/lib/canvasSocial';
import type { MiroBoardSummary, MiroImportResult } from '@/lib/miroImport';
import { IMPORT_COLUMN_GAP } from '../canvasFileDrop';
import { canvasMediaSource, isCanvasMediaKind } from '@/lib/canvasPublicMedia';
import type { CreationNodeData } from '../types';
import { newNode } from '../canvasNodeHelpers';
import { nextCanvasObjectPosition } from '../creationCanvasLayout';
import type { useTranslations } from 'next-intl';
import type { CanvasProposalStage } from '@/domains/canvas/application/CanvasProposalStage';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import type { CanvasLayoutViewport } from '@/lib/canvasGridFit';

export interface UseCanvasConnectedSourcesDeps {
  canEdit: boolean;
  connectedAccountGate: (source: string) => boolean;
  layoutViewportRef: RefObject<() => CanvasLayoutViewport>;
  nodes: CanvasObject[];
  placeAppendedRef: RefObject<(current: readonly CreationFlowNode[], additions: readonly CreationFlowNode[]) => CreationFlowNode[]>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  stage: CanvasProposalStage;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  tMiro: ReturnType<typeof useTranslations<'creationCanvas.miro'>>;
  tSocial: ReturnType<typeof useTranslations<'creationCanvas.social'>>;
}

export function useCanvasConnectedSources({ canEdit, connectedAccountGate, layoutViewportRef, nodes, placeAppendedRef, setEdges, setNodes, setNotice, setSelectedId, setSelectedIds, stage, t, tMiro, tSocial }: UseCanvasConnectedSourcesDeps) {
  /**
   * ONE credential check in front of every social tool.
   *
   * Gated on CREDENTIALS, not on whether the board is saved — the same distinction
   * `canvas_add_image` draws and for the same reason: `/api/social/*` is a stateless
   * request carrying the tenant token, so a signed-in user on an unsaved board connects,
   * drafts and publishes for real. `persistence` still gates what needs a SAVED SESSION
   * to point at, which for social is exactly one thing: the campaign's `sessionId` link.
   *
   * Read from the token store per call rather than closing over `hasAccount`, so a
   * sign-in mid-session is reflected on the very next tool call.
   *
   * Six tools rather than six copies of this: the model must never be able to reach a
   * social tool that returns a different reason than its siblings, because the reason IS
   * the answer the user gets — see CANVAS_SOCIAL_ACCOUNT_GATE.
   */
  const socialAccountGate = useCallback((tool: string): { requiresAccount: true; tool: string; error: string } | null => {
    // Same door as the menu entry — a model asking for the social panel and a
    // person clicking it must not describe the missing account two ways.
    if (connectedAccountGate(tSocial('title'))) return null;
    return accountGateResult(tool, CANVAS_SOCIAL_ACCOUNT_GATE);
  }, [connectedAccountGate, tSocial]);

  /**
   * Read the connected social accounts and BUILD the feed tile — without adding it.
   *
   * Shared by `canvas_add_social_feed` (which stages it as a reviewable proposal) and
   * the social panel (which commits it immediately). One builder, so the tile a model
   * puts on the board and the one a person puts there are identical — the alternative
   * is two shapes that drift, and a refresh that works on only one of them.
   */
  const buildSocialFeedNode = useCallback(async (
    filter: SocialFeedFilter,
    opts: { title?: string; x?: number; y?: number } = {},
  ): Promise<{ ok: true; node: CreationFlowNode; read: Awaited<ReturnType<typeof socialApi.feed>> } | { ok: false; error: string }> => {
    let read: Awaited<ReturnType<typeof socialApi.feed>>;
    try {
      read = await socialApi.feed(filter);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : tSocial('feedFailed') };
    }
    if (read.accounts.length === 0) {
      // Actionable rather than a bare failure: the fix is one panel away.
      return { ok: false, error: tSocial('noAccountsHint') };
    }
    const node = stage.createObject('socialFeed', { ...(opts.x != null ? { x: opts.x } : {}), ...(opts.y != null ? { y: opts.y } : {}) });
    node.data = {
      ...node.data,
      title: opts.title?.trim().slice(0, 160) || tSocial('feedTitle'),
      subtitle: describeSocialFilter(filter, {
        all: tSocial('filterAll'),
        networks: (list) => tSocial('filterNetworks', { networks: list }),
        search: (term) => tSocial('filterSearch', { term }),
      }),
      status: tSocial('postCount', { count: read.items.length }),
      filter,
      ...socialFeedPatch(read),
    };
    node.style = { width: 460, height: 560 };
    return { ok: true, node, read };
  }, [nodes, stage, tSocial]);

  /** The panel's "put it on the board" — a committed add, not a proposal. */
  const addSocialFeedToBoard = useCallback(async (filter: SocialFeedFilter) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const built = await buildSocialFeedNode(filter);
    if (!built.ok) { setNotice(built.error); return; }
    setNodes((current) => [...current, ...placeAppendedRef.current(current, [built.node])]);
    setSelectedId(built.node.id); setSelectedIds([built.node.id]);
    setNotice(t('objectAdded', { title: built.node.data.title }));
  }, [buildSocialFeedNode, canEdit, setNodes, t]);

  /**
   * A Miro board, landed on this canvas.
   *
   * The mapper normalises the imported graph to its own origin, so the only thing
   * left to decide is WHERE on this board it goes — and that has to be clear of
   * whatever is already here. Dropping it at the viewport centre would overlay an
   * imported 200-sticky workshop on top of the work in progress, which reads as
   * corruption rather than as an import. It lands to the right of everything, the
   * way a second page does.
   */
  const importMiroBoard = useCallback(async (result: MiroImportResult, board: MiroBoardSummary) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    if (!result.nodes.length) { setNotice(tMiro('importedNothing', { name: board.name || board.id })); return; }
    const rightEdge = nodes.reduce((widest, node) => {
      const width = typeof node.style?.width === 'number' ? node.style.width : 320;
      return Math.max(widest, node.position.x + width);
    }, 0);
    const offsetX = nodes.length ? rightEdge + IMPORT_COLUMN_GAP : 0;
    const placed = result.nodes.map((node) => ({ ...node, position: { x: node.position.x + offsetX, y: node.position.y } }));
    setNodes((current) => [...current, ...placeAppendedRef.current(current, placed)]);
    setEdges((current) => [...current, ...result.edges]);
    setSelectedId(placed[0]!.id);
    setSelectedIds(placed.map((node) => node.id));
    setNotice(result.skipped.length
      ? tMiro('importedWithSkips', { name: board.name || board.id, count: placed.length, types: result.skipped.join(', ') })
      : tMiro('imported', { name: board.name || board.id, count: placed.length }));
  }, [canEdit, nodes, setEdges, setNodes, t, tMiro]);

  /**
   * The pictures on this board, for the composer's attachment picker.
   *
   * Derived here rather than inside the panel because the canvas owns the nodes —
   * the same reason adding a tile is a callback. Only objects that actually HOLD a
   * picture are offered: an `image` card whose generation has not finished has no
   * source yet, and listing it would produce a post with nothing attached.
   */
  const boardMedia = useMemo(() => nodes.flatMap((node) => {
    if (!isCanvasMediaKind(node.data.kind)) return [];
    const source = canvasMediaSource(node.data);
    if (!source) return [];
    const thumbnail = typeof node.data.thumbnailUrl === 'string' && node.data.thumbnailUrl ? node.data.thumbnailUrl : source;
    return [{
      id: node.id,
      title: String(node.data.title || node.data.kind),
      source,
      thumbnailUrl: thumbnail.startsWith('data:') || /^https?:\/\//i.test(thumbnail) ? thumbnail : null,
    }];
  }), [nodes]);

  const addSocialCampaignToBoard = useCallback((campaign: SocialCampaign) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const data = socialCampaignNodeData(campaign);
    setNodes((current) => {
      // A campaign already on the board is UPDATED, never duplicated — publishing from
      // the panel must move the tile that is there rather than stack a second one.
      const existing = current.find((node) => node.data.kind === 'socialCampaign' && Number(node.data.campaignId) === campaign.id);
      if (existing) {
        return current.map((node) => node.id === existing.id ? { ...node, data: { ...node.data, ...data } as CreationNodeData } : node);
      }
      const node = newNode('socialCampaign', nextCanvasObjectPosition(
        current, {}, layoutViewportRef.current(), 'socialCampaign',
      ));
      node.data = { ...node.data, ...data } as CreationNodeData;
      node.style = { width: 440, height: 460 };
      return [...current, node];
    });
  }, [canEdit, setNodes, t]);
  return { socialAccountGate, buildSocialFeedNode, importMiroBoard, addSocialFeedToBoard, addSocialCampaignToBoard, boardMedia };
}
