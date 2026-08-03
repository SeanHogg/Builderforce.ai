import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  streamChatCompletion,
  type BrainAction,
  type BrainToolSpec,
  type ChatCompletionMessage,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestChatApi';

type CanvasAiOptions = {
  prompt: string;
  canvasSnapshot: string;
  persistence: 'local' | 'server';
  canvasActions: BrainAction[];
  /** Session-owned transcript. The Canvas is the chat, so prior turns must travel with
   * every request just as they do in the standalone Brain surface. */
  conversation?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  onText?: (text: string) => void;
};

function specsFor(actions: BrainAction[]): BrainToolSpec[] {
  return actions.map((action) => ({
    type: 'function',
    function: { name: action.name, description: action.description, parameters: action.parameters },
  }));
}

function mutates(action: BrainAction, args: unknown): boolean {
  if (typeof action.mutates === 'function') {
    try { return !!action.mutates(args); } catch { return true; }
  }
  return !!action.mutates;
}

/** Run a small, bounded agent loop over the active canvas and shared MCP catalog. */
export async function runCreationCanvasAi(options: CanvasAiOptions): Promise<string> {
  if (options.persistence === 'local' && !(await ensureGuestToken())) {
    throw new Error('Guest AI is unavailable. Your canvas remains editable on this device.');
  }
  const config = options.persistence === 'server' ? brainConfig : guestBrainConfig;
  const transport = config.transport;
  let mcpActions: BrainAction[] = [];
  if (options.persistence === 'server') {
    try {
      const entries = await fetchMcpToolEntries(transport);
      mcpActions = mcpActionsFrom(entries, transport);
    } catch {
      // Canvas-native AI remains useful if an MCP extension is temporarily down.
    }
  }
  const actions = [...options.canvasActions, ...mcpActions];
  const byName = new Map(actions.map((action) => [action.name, action]));
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: `You are Brain operating BuilderForce's unified creation canvas. Use the provided canvas_* function tools to make requested visual changes instead of writing code or merely describing them. Treat imperative requests as instructions to act now: do not ask for optional names or descriptions, and use sensible authored defaults when details are omitted. Requests to create or add an artifact on this Canvas must use canvas_add_object, even when an MCP tool has a similar resource name. For example, "create a workflow" means call canvas_add_object with kind "workflow" and authored workflow fields; do not call builtin_workflows_create or ask a follow-up question. Use MCP tools for a mutation only when the user explicitly asks to create or change a canonical tenant resource outside the Canvas. For model requests, kind "llm" is a conventional language-model blueprint; kind "evermind" is BuilderForce's self-learning Evermind model with teach, train, evaluate, and publish capabilities. If the user says LLM, create kind "llm" unless they explicitly ask for Evermind or a continuously learning/self-updating model. Read each object's mutableFields before updating it. When creating an authored artifact, put the complete result in fields.content or fields.markdown and populate its other type-specific fields; do not create an empty shell. Canvas mutations are proposals the user reviews before they are applied. Never claim a mutation succeeded unless its tool result confirms it. Never emit tool_code, Python, or a simulated tool result in assistant text. Current canvas:\n${options.canvasSnapshot}`,
    },
    ...(options.conversation || []).slice(-20).map((message) => ({ ...message, content: message.content.slice(0, 8_000) })),
    { role: 'user', content: options.prompt },
  ];
  let finalText = '';
  for (let turn = 0; turn < 3; turn += 1) {
    const result = await streamChatCompletion({
      transport,
      messages,
      tools: specsFor(actions),
      tool_choice: 'auto',
      maxTokens: 1600,
      reasoning: { level: 'low' },
    }, { onTextDelta: (delta) => { finalText += delta; options.onText?.(finalText); } });
    if (!result.toolCalls.length) return result.text || finalText;
    messages.push({
      role: 'assistant', content: result.text,
      tool_calls: result.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })),
    });
    for (const call of result.toolCalls) {
      const action = byName.get(call.name);
      let args: unknown = {};
      try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }
      let outcome: unknown;
      if (!action) {
        outcome = { error: `Unknown tool: ${call.name}` };
      } else if (!call.name.startsWith('canvas_') && mutates(action, args) && !window.confirm(`Allow Brain to run ${call.name}?`)) {
        outcome = { error: 'The user declined this tenant mutation.' };
      } else {
        try { outcome = await action.run(args); } catch (error) { outcome = { error: error instanceof Error ? error.message : 'Tool failed' }; }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) });
    }
    finalText = '';
  }
  return finalText || 'I made the available canvas changes.';
}
