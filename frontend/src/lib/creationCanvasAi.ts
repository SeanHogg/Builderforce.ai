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
      content: `You are Brain operating BuilderForce's unified creation canvas. Use canvas tools to make requested visual changes instead of merely describing them. Use MCP tools when the user asks to read or change tenant resources. Never claim a mutation succeeded unless its tool result confirms it. Current canvas:\n${options.canvasSnapshot}`,
    },
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

