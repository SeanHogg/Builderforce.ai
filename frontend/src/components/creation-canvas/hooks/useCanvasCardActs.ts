/** Acting on a card — release gates, card acts and polls. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from 'react';
import { releaseGateEvidence } from '../canvasReleaseEvidence';
import { normalizeExitCriteria, planGateVerdict } from '@/lib/canvasQa';
import { type CardActBoardBinding, useCardActRunnerFor } from '../cardActRunner';
import { newNode } from '../canvasNodeHelpers';
import { publishPoll, setPollState } from '@/lib/pollApi';
import { pollJoinUrl, pollPublishBody } from '@/lib/pollObject';
import type { CreationNodeData } from '../types';
import { faultText } from '@/lib/apiClient';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { Edge } from '@xyflow/react';
import type { useTranslations } from 'next-intl';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';

export interface UseCanvasCardActsDeps {
  canvasText: CanvasTextTranslator;
  edges: Edge[];
  nodes: CanvasObject[];
  nodesRef: RefObject<CanvasObject[]>;
  persistence: 'local' | 'server';
  requireAccount: (action: string, title: string, description: string) => void;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setNodes: Dispatch<SetStateAction<CanvasObject[]>>;
  setNotice: (text: string) => void;
  setSurface: (next: CanvasSurfaceId, targetId?: string | null, origin?: CanvasSurfaceId | null) => void;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  tPoll: ReturnType<typeof useTranslations<'poll'>>;
  updateNodeData: (nodeId: string, patch: Partial<CreationNodeData>) => void;
}

export function useCanvasCardActs({ canvasText, edges, nodes, nodesRef, persistence, requireAccount, setEdges, setNodes, setNotice, setSurface, t, tPoll, updateNodeData }: UseCanvasCardActsDeps) {
  /**
   * Evaluate a test plan's exit criteria against the evidence ON THE BOARD.
   *
   * ── WHY THIS IS DERIVED AND NEVER AUTHORED ───────────────────────────────────
   * The Creation Canvas release gate was a hand-edited `canvas-release-evidence.json`
   * whose only real validation was that the `REPLACE_` placeholder had been deleted —
   * so it certified whatever someone typed. The same criteria are worth gating on;
   * what was wrong was where the numbers came from.
   *
   * So `gateVerdict` is absent from `MUTABLE_FIELDS.testPlan` (a model that could
   * write its own verdict could report a release green that nothing ran), and this is
   * its only writer. The evidence itself comes from `releaseGateEvidence`, which the
   * JSON export also reads — one definition of "an open defect", two consumers.
   */
  const evaluateReleaseGate = useCallback((planId: string) => {
    const plan = nodes.find((node) => node.id === planId && node.data.kind === 'testPlan');
    if (!plan) return;
    const evidence = releaseGateEvidence(plan, nodes, edges);
    const connected = new Set(edges.filter((edge) => edge.source === plan.id).map((edge) => edge.target));
    const verdict = planGateVerdict(normalizeExitCriteria(plan.data.exitCriteria), evidence);
    setNodes((current) => current.map((node) => node.id === plan.id
      ? {
        ...node,
        data: {
          ...node.data,
          gateVerdict: verdict,
          passRate: evidence.runs[0]?.passRate ?? null,
          caseCount: nodes.filter((candidate) => candidate.data.kind === 'testCase' && connected.has(candidate.id)).length,
        },
      }
      : node));
    setNotice(t('noticeGateEvaluated', { score: verdict.score }));
  }, [edges, nodes, setNodes, t]);

  /**
   * A CARD ACT — `invoice.issue`, `offer.hire`, `submission.mark`, and seven more.
   *
   * Ten `useCallback`s used to live here, one per act, each repeating the same six
   * steps: find the card by id and kind, refuse without an account, validate its
   * fields, do the work, stamp the result back, say what happened. They are now
   * registry entries owned by the contexts they belong to — finance, hiring,
   * teaching — and this is the ONE place the board is mutated on their behalf.
   *
   * The dispatch below asks `cardActFor` FIRST rather than calling this and
   * checking, because the chain it sits in is synchronous and "did an act answer"
   * has to be known before the next `else if` is considered.
   */
  // The runner itself now lives in `cardActRunner.tsx` and is PUBLISHED to the board
  // rather than held in this closure, so a surface that wants a button for an act reads
  // it from context instead of being handed a callback threaded through the inspector's
  // prop list. This binding is the only thing that stays here: applying an outcome is
  // still the one place the board is mutated on an act's behalf.
  const cardActBoard = useMemo<CardActBoardBinding>(() => ({
    objects: () => nodesRef.current,
    create: newNode,
    setNodes,
    setEdges,
    setNotice,
    persistence,
    t: canvasText,
  }), [persistence, setEdges, setNodes, setNotice, canvasText]);
  const runCardActOnObject = useCardActRunnerFor(cardActBoard);

  /**
   * The poll's four acts, run from the BOARD rather than from the room.
   *
   * The facilitation surface has the same four buttons, and both call the same two
   * endpoints through the same card reading (`pollPublishBody`) — a second reading of
   * what `options` means would be a second poll out of one card, and the one that drifts
   * is the one reached through a model rather than through a person.
   *
   * `publish` ends by OPENING the surface: the next thing that happens after a poll is
   * published is a room being asked to answer it, and leaving the facilitator on the
   * board with an address they cannot read out is the wrong place to stop.
   */
  const runPollAction = useCallback(async (nodeId: string, action: string) => {
    const target = nodesRef.current.find((node) => node.id === nodeId);
    if (!target) return;
    // A poll reaches real people at a public address, which is a tenant resource. A
    // local board has no tenant, so this is the account gate rather than a failure.
    if (persistence !== 'server') { requireAccount('publish', tPoll('accountTitle'), tPoll('accountBody')); return; }
    try {
      if (action === 'publish') {
        const result = await publishPoll(pollPublishBody(target.data, nodeId));
        updateNodeData(nodeId, {
          questionSetId: result.questionSetId,
          joinUrl: pollJoinUrl(result.slug),
          status: tPoll('statusOpen'),
        } as Partial<CreationNodeData>);
        setSurface('facilitate', nodeId);
        setNotice(tPoll('noticePublished'));
        return;
      }
      const questionSetId = typeof target.data.questionSetId === 'string' ? target.data.questionSetId : '';
      if (!questionSetId) { setNotice(tPoll('noticePublishFirst')); return; }
      const next = await setPollState(questionSetId, action === 'open'
        ? { status: 'open' }
        : action === 'close'
          ? { status: 'closed' }
          // `reveal` shows the room the count. Deliberately one-way here: hiding it again
          // is a facilitation move made in front of the room, on the surface, not
          // something a model should be able to do to a screen people are reading.
          : { showResultsLive: true });
      updateNodeData(nodeId, {
        showResultsLive: next.showResultsLive,
        status: next.status === 'open' ? tPoll('statusOpen') : tPoll('statusClosed'),
      } as Partial<CreationNodeData>);
      setNotice(next.status === 'open' ? tPoll('noticeVotingOpen') : tPoll('noticeVotingClosed'));
    } catch (error) {
      setNotice(faultText(error, tPoll('publishFailed')));
    }
  }, [persistence, requireAccount, setSurface, tPoll, updateNodeData]);
  return { runPollAction, evaluateReleaseGate, runCardActOnObject, cardActBoard };
}
