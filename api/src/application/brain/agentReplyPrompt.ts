/**
 * The addressed-agent reply's TOOLSET and SYSTEM PROMPT. Split out of
 * `BrainService.agentReply` (now `agentReply.ts`).
 *
 * The toolset is resolved BEFORE the prompt because the prompt must name tools by
 * the string the model was actually given — see `agentReplyToolset`.
 */

import { listBuiltinTools, CLOUD_AGENT_PLATFORM_TOOLS, CHAT_SCOPED_AGENT_TOOLS } from '../llm/builtinMcpService';
import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { accountabilityFraming } from './accountabilityFraming';
import type { ChatMode } from './chatMode';

/**
 * Curated, non-destructive platform tools (the same allowlist an autonomous cloud
 * agent gets) PLUS the chat-scoped read/link tools that only make sense with a live
 * chatId (so an agent addressed in a chat can link work to it). Advertised name →
 * tool id map for executing the model's calls.
 *
 * Resolved BEFORE the system prompt because the prompt must name tools by the string
 * the model was actually given. It previously named them by catalog id (`manager.digest`,
 * `chats.link_ticket`) — names that appear nowhere in the model's tool list — and the
 * measured result was an agent narrating the calls it could not make instead of making
 * them. `nameFor` returns null for a tool that is not advertised on this turn, so a
 * prompt clause referencing it is DROPPED rather than pointing at nothing.
 */
export function agentReplyToolset() {
  const agentToolIds = [...CLOUD_AGENT_PLATFORM_TOOLS, ...CHAT_SCOPED_AGENT_TOOLS];
  const toolEntries = listBuiltinTools().filter((t) => agentToolIds.includes(t.tool));
  const nameToTool = new Map(toolEntries.map((t) => [t.name, t.tool]));
  const toolToName = new Map(toolEntries.map((t) => [t.tool, t.name]));
  const nameFor = (toolId: string): string | null => toolToName.get(toolId) ?? null;
  // Advertise the platform tools PLUS the conversational `ask_user` tool (injected
  // here, intercepted in the loop as a terminal turn — see ASK_USER_TOOL_SPEC).
  const tools = [
    ...toolEntries.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    ASK_USER_TOOL_SPEC,
  ];
  return { tools, nameToTool, nameFor };
}

export type AgentReplyToolset = ReturnType<typeof agentReplyToolset>;

export interface AgentReplyPromptInput {
  persona: string;
  agentName: string;
  chatId: number;
  projectHint: number | null;
  boardGrounding: string | null;
  isManagerChat: boolean;
  chatMode: ChatMode;
  nameFor: (toolId: string) => string | null;
}

export function agentReplySystemPrompt(input: AgentReplyPromptInput): string {
  const { persona, agentName, chatId, projectHint, boardGrounding, isManagerChat, chatMode, nameFor } = input;
  const executeAsMe = nameFor('chats.execute_as_agent');
  const linkTicket = nameFor('chats.link_ticket');
  const listTickets = nameFor('chats.list_tickets');
  return [
    persona,
    `You have been addressed directly in this multi-party team chat${projectHint != null ? ` (project #${projectHint})` : ''}. `,
    ...(boardGrounding ? [`\n\n${boardGrounding}\n\n`] : []),
    // The MANAGER chat's framing (0376). It lives here rather than only in the built-in
    // Manager agent's persona because a tenant may designate its OWN cloud agent to run
    // the backlog, and that agent's persona knows nothing about being accountable for
    // it. The standard has to attach to the CONVERSATION, not to one agent row, or the
    // answer quality would silently depend on who was designated.
    ...(isManagerChat && projectHint != null ? [accountabilityFraming(projectHint, nameFor)] : []),
    `Reply AS ${agentName} — first person, concise, helpful, no preamble and no "${agentName}:" label. `,
    `You may use the provided tools to read or update the team's work (projects, tasks, specs, OKRs, knowledge) when it helps answer or act on the request. After using tools, summarise what you found or did. `,
    // This reply runs on the Worker with no working tree; the agent's clone, shell and
    // git live in its RUNTIME. An instruction that needs them is HANDED to that runtime
    // through `chats.execute_as_agent` — the agent used to answer "I don't have git
    // commit/push tools", true of this reply and false of the agent.
    ...(executeAsMe
      ? [`This reply itself has NO file, shell or git tools — your working tree, shell and git live in YOUR RUNTIME. When the user asks you to do repository work (edit, build, test, merge, commit, push, ship), call ${executeAsMe}(chatId=${chatId}, directive=<their instruction, verbatim>): it steers your live run, resumes a paused one, or starts a follow-up run on the same branch your previous run left its changes on, and that run narrates here. NEVER reply that you lack a git or file tool. After the call, report what happened (steered / resumed / a new run and its id, or that it awaits approval) and where to watch it. `]
      : [`You have NO file, shell or git tools in this reply. If asked for repository work, say so in one line and point to the ticket's run (the Output tab's Send starts a follow-up run on your branch). `]),
    // The agent IS a participant in this chat (chatId is known here, not to the model) —
    // tell it the id so it can tie work items to THIS conversation. Named by ADVERTISED
    // name for the same reason as above; dropped entirely when the tools are not offered.
    `You are participating in Brain chat #${chatId}. `,
    // MODE (0409). In a CONVERSATION the agent answers and stops; in an EXECUTION it
    // ties what it concludes to the chat as real, tracked work. Without this an
    // addressed agent opened tickets off the back of a question, which is the same
    // defect the client-side loop had.
    chatMode === 'work'
      ? (linkTicket && listTickets
          ? `This conversation is in WORK mode: turn what you conclude into real work rather than describing it. Tie every work item you create or discuss to the chat with ${linkTicket}(chatId=${chatId}), and use ${listTickets}(chatId=${chatId}) to see what is already linked so you never duplicate one. `
          : '')
      : `This conversation is in CHAT mode: answer the question. Read and investigate freely, but do not create, re-status or dispatch board work as a side effect of answering — unless the user explicitly asks you to in this message. If something clearly ought to be tracked, say so in one line at the end and leave it to the user. `,
    `When you need the user to make a decision before you can proceed (an owner, an approach, one target vs another), call the ${ASK_USER_TOOL} tool with labelled options INSTEAD of asking in prose — do not end your reply with unanswered questions when ${ASK_USER_TOOL} would let the user just click a choice.`,
  ].join('');
}
