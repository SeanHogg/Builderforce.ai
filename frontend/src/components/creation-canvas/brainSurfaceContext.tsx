'use client';

/**
 * The channel that lets the Brain Object on the graph BE the conversation.
 *
 * When the Brain surface is inline, the transcript renders inside the Brain Object
 * node instead of in an edge panel. A React Flow node cannot simply take that state
 * as a prop: `nodeTypes` has to keep a stable identity or React Flow remounts every
 * node on the board, so anything that changes per token (messages, trace, running)
 * has to reach the node some other way. Context is that way.
 *
 * It is consumed by the Brain Object's body ALONE — never by CreationNode itself —
 * so a streaming reply re-renders one node, not the whole board.
 */

import { createContext, useContext } from 'react';
import type { Edge } from '@xyflow/react';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import type { GuestSignupPrompt } from '@/components/GuestSignupCta';
import type { CreationFlowNode } from './CreationNode';
import type { BrainDockMode } from './brainDockPreferences';

export interface BrainSurfaceCollaborator {
  userId: string;
  displayName: string | null;
  typing?: boolean;
}

export interface BrainSurfaceContextValue {
  /** False in present mode or when the user closed Brain — the Object shows its anchor. */
  open: boolean;
  /** False while presenting, where nothing can reveal Brain — so nothing offers to. */
  canOpen: boolean;
  mode: BrainDockMode;
  showExecutionDetail: boolean;
  running: boolean;
  /** Epoch ms the in-flight turn began, so every surface narrates the same phase. */
  runStartedAt: number | null;
  messages: BrainMessage[];
  trace: BrainTraceEvent[];
  nodes: CreationFlowNode[];
  edges: Edge[];
  collaborators: BrainSurfaceCollaborator[];
  joinedCollaborator: BrainSurfaceCollaborator | null;
  /** Re-send a transcript message as the next canvas turn ("send again"). */
  onReplayMessage: (message: BrainMessage, role: 'user' | 'assistant') => void;
  /** The guest wall this conversation ran into, so BOTH placements offer the same
   *  way forward. Null on every signed-in board. */
  guestSignup: GuestSignupPrompt | null;
  /** Select the Brain Object and reveal the conversation, wherever it lives. */
  onOpen: (nodeId: string) => void;
  onModeChange: (mode: BrainDockMode) => void;
  onExecutionDetailChange: (show: boolean) => void;
  onClose: () => void;
}

const BrainSurfaceContext = createContext<BrainSurfaceContextValue | null>(null);

export const BrainSurfaceProvider = BrainSurfaceContext.Provider;

/**
 * Null outside a canvas (an isolated node render, a test, an export). The Brain
 * Object falls back to its anchor preview there, which reads from node data alone.
 */
export function useBrainSurface(): BrainSurfaceContextValue | null {
  return useContext(BrainSurfaceContext);
}
