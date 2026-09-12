import { brain, type BrainMessage, type ChatAgentInvite } from './builderforceApi';
import { mentionsAny } from './canvas/agentMentions';

export interface CanvasAgentParticipant { ref: string; name: string; kind?: string; role?: string }

/**
 * @mentions narrow a turn; "ask all" and unaddressed group turns reach everyone. The
 * matching is the canvas's own (`mentionsAny`), so the group chat and the board agree
 * on who a prompt names.
 */
export function addressedCanvasAgents(prompt: string, agents: readonly CanvasAgentParticipant[]): CanvasAgentParticipant[] {
  const mentioned = agents.filter((agent) => mentionsAny(prompt, [agent.name, agent.ref]));
  return mentioned.length ? mentioned : [...agents];
}

function messageAuthor(message: BrainMessage, fallback: CanvasAgentParticipant): CanvasAgentParticipant {
  if (!message.metadata) return fallback;
  try {
    const author = (JSON.parse(message.metadata) as { authoredBy?: { ref?: string; name?: string } }).authoredBy;
    return { ...fallback, ...(author?.ref ? { ref: author.ref } : {}), ...(author?.name ? { name: author.name } : {}) };
  } catch { return fallback; }
}

export interface CanonicalCanvasGroupTurn {
  chatId: number;
  contributions: Array<{ agent: CanvasAgentParticipant; message: BrainMessage }>;
}

/** Persist and run a Canvas group turn through the canonical workforce chat runtime. */
export async function runCanonicalCanvasGroupTurn(input: {
  chatId?: number | null;
  title: string;
  projectId?: number | null;
  sessionId: string;
  prompt: string;
  agents: readonly CanvasAgentParticipant[];
}): Promise<CanonicalCanvasGroupTurn> {
  const chatId = input.chatId ?? (await brain.createChat({ title: `${input.title} — Create`, projectId: input.projectId ?? null, capability: 'create' })).id;
  const invited = await brain.listChatAgents(chatId);
  const existing = new Set(invited.map((agent: ChatAgentInvite) => agent.agentRef));
  await Promise.all(input.agents.filter((agent) => !existing.has(agent.ref)).map((agent) => brain.inviteChatAgent(chatId, {
    agentRef: agent.ref, agentKind: agent.kind || 'workforce', role: agent.role || 'creator',
  })));
  const addressed = addressedCanvasAgents(input.prompt, input.agents);
  await brain.sendMessages(chatId, [{
    role: 'user', content: input.prompt,
    metadata: JSON.stringify({ creationSessionId: input.sessionId, addressedTo: addressed.length === 1 ? { kind: 'agent', ref: addressed[0]!.ref, name: addressed[0]!.name } : { kind: 'group', refs: addressed.map((agent) => agent.ref) } }),
  }]);
  const replies = await Promise.all(addressed.map(async (agent) => {
    const message = await brain.requestAgentReply(chatId, { agentRef: agent.ref, agentName: agent.name });
    return { agent: messageAuthor(message, agent), message };
  }));
  return { chatId, contributions: replies };
}
