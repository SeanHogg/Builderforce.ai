import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { BrainSurfaceBodyProps } from '../BrainDock';
import type { CreationFlowNode } from '../CreationNode';
import type { BrainDockPreferences } from '../brainDockPreferences';
import type { useCanvasBrainSurface } from '../hooks/useCanvasBrainSurface';

type BrainSurface = ReturnType<typeof useCanvasBrainSurface>;

/** The live conversation as BOTH of its full-size placements take it. */
export type BrainConversationProps = BrainSurfaceBodyProps & { onExecutionDetailChange: (show: boolean) => void };

export interface BrainConversationInput {
  brain: Pick<BrainSurface, 'brainMessages' | 'brainReveal' | 'brainRunning' | 'brainRunShownStartedAt' | 'brainNode' | 'brainCollaborators' | 'replayBrainMessage' | 'brainSurface' | 'guestSignupPrompt'>;
  showExecutionDetail: boolean;
  updateBrainDock: (patch: Partial<BrainDockPreferences>) => void;
  trace: BrainTraceEvent[];
  nodes: CreationFlowNode[];
  edges: Edge[];
  joinedCollaborator: BrainSurfaceBodyProps['joinedCollaborator'];
}

/**
 * ONE conversation, two placements. The chat SURFACE and the edge DOCK used to be handed
 * the same sixteen props spelled out twice, which is two lists to keep in step every time
 * the transcript learns something new. They are one memoized bundle now, spread into
 * both, so they cannot drift into two subtly different chats.
 */
export function useBrainConversation({ brain, showExecutionDetail, updateBrainDock, trace, nodes, edges, joinedCollaborator }: BrainConversationInput): BrainConversationProps {
  const { brainMessages, brainReveal, brainRunning, brainRunShownStartedAt, brainNode, brainCollaborators, replayBrainMessage, brainSurface, guestSignupPrompt } = brain;
  return useMemo(() => ({
    showExecutionDetail,
    onExecutionDetailChange: (show: boolean) => updateBrainDock({ showExecutionDetail: show }),
    messages: brainMessages,
    revealMessage: brainReveal,
    trace,
    running: brainRunning,
    runStartedAt: brainRunShownStartedAt,
    node: brainNode,
    nodes,
    edges,
    collaborators: brainCollaborators,
    joinedCollaborator,
    onReplayMessage: replayBrainMessage,
    onRateMessage: brainSurface.onRateMessage,
    ratings: brainSurface.ratings,
    guestSignup: guestSignupPrompt,
  }), [brainCollaborators, brainMessages, brainNode, brainReveal, brainRunShownStartedAt, brainRunning, brainSurface.onRateMessage, brainSurface.ratings, edges, guestSignupPrompt, joinedCollaborator, nodes, replayBrainMessage, showExecutionDetail, trace, updateBrainDock]);
}
