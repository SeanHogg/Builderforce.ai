/** Who answers a Brain turn — the addressed or connected agents, and which of them are REAL agents. */
import type { Edge } from '@xyflow/react';
import { mentionedBoardAgents } from '@/lib/canvas/agentMentions';
import { boardAgents } from '@/lib/canvas/boardAgents';
import type { CanvasAgentParticipant } from '@/lib/creationAgentChat';
import type { CreationFlowNode } from '../CreationNode';

/**
 * WHO THIS TURN IS FOR. An @-mention names its agents outright, wherever they are on
 * the board; without one, the agents in reach (selected, or wired to Brain) answer.
 * Mentions used to reach only the model: "@Manager @CFO @Counsel" with Counsel
 * selected asked Counsel alone, and Brain wrote the other two's parts for them.
 */
export function turnAgentNodes(
  requestText: string,
  nodes: readonly CreationFlowNode[],
  edges: readonly Edge[],
  effectiveSelectedIds: readonly string[],
  brainId: string,
): CreationFlowNode[] {
  const mentionedIds = new Set(mentionedBoardAgents(requestText, boardAgents(nodes)).map((agent) => agent.objectId));
  return mentionedIds.size
    ? nodes.filter((node) => mentionedIds.has(node.id))
    : nodes.filter((node) => node.data.kind === 'agent' && (
      effectiveSelectedIds.includes(node.id)
      || edges.some((edge) => (edge.source === brainId && edge.target === node.id) || (edge.target === brainId && edge.source === node.id))
    )).slice(0, 3);
}

/** The turn's agents that name a REAL agent, and the canvas object ids they came from. */
export function canonicalTurnAgents(connectedAgentNodes: readonly CreationFlowNode[]): { agents: CanvasAgentParticipant[]; objectIds: Set<string> } {
  const objectIds = new Set<string>();
  const agents = connectedAgentNodes.flatMap((agent) => {
    // Two ways a card names a REAL agent: a canonical `agent:<id>` resource, or the
    // `ide_agents.id` a seated built-in teammate carries (`cmo-t14`, see
    // provisionBuiltinAgents / seatTeammate). The second was not read, so on a
    // signed-in board an @CMO fell through to the local-drafts branch (`runCanvasGroupTurn`) — a
    // full browser tool loop per seat, each free to build, then a synthesis that
    // could not see what they had built. Measured (session bf886fc1): the same
    // app provisioned twice, every competitor card twice, four-minute turns. An
    // @-addressed agent executes in ITS runtime, which is this path.
    const ref = agent.data.resourceId?.match(/^agent:(.+)$/)?.[1]
      ?? (agent.data.builtinAgent === true && typeof agent.data.agentRef === 'string' && agent.data.agentRef.trim()
        ? agent.data.agentRef.trim()
        : undefined);
    if (ref) objectIds.add(agent.id);
    return ref ? [{ ref, name: agent.data.title || 'Specialist agent', role: typeof agent.data.role === 'string' ? agent.data.role : undefined }] : [];
  });
  return { agents, objectIds };
}
