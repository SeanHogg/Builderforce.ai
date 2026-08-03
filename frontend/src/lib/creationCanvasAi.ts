import {
  fetchMcpToolEntries,
  mcpActionsFrom,
  streamChatCompletion,
  formatEvermindMemoryBlock,
  countReconciledMemories,
  type BrainAction,
  type BrainTraceEvent,
  type BrainToolSpec,
  type ChatCompletionMessage,
  type EvermindRecallResult,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestChatApi';

type CanvasAiOptions = {
  prompt: string;
  canvasSnapshot: string;
  persistence: 'local' | 'server';
  canvasActions: BrainAction[];
  model?: string;
  modelStrict?: boolean;
  routingMode?: 'auto' | 'byo_pool';
  /** Uses the same persisted mode as the canonical Brain: mutating tenant tools run
   * without an additional browser confirmation and canvas proposals auto-apply. */
  autoApprove?: boolean;
  evermind?: {
    recall: (query: string) => Promise<EvermindRecallResult | null>;
    learn: (answer: string, prompt: string) => Promise<{ ok: boolean; queued?: number }>;
  };
  onTrace?: (event: BrainTraceEvent) => void;
  /** Awaitable in-app approval. Mutating tenant actions are refused when this is
   * absent; the runner must never fall back to a browser-native prompt. */
  confirmAction?: (request: { name: string; args: unknown }) => Promise<boolean>;
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
  let recalled: EvermindRecallResult | null = null;
  if (options.evermind) {
    try { recalled = await options.evermind.recall(options.prompt); } catch { recalled = null; }
    if (recalled?.seeded && recalled.items.length) options.onTrace?.({
      ts: new Date().toISOString(), category: 'recall', label: 'evermind.recall',
      args: { query: options.prompt, version: recalled.version },
      result: { count: recalled.items.length, version: recalled.version, mode: recalled.mode, items: recalled.items },
    });
  }
  const memoryBlock = recalled?.seeded ? formatEvermindMemoryBlock(recalled.items) : '';
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: `You are Brain operating BuilderForce's unified creation canvas. Use the provided canvas_* function tools to make requested visual changes instead of writing code or merely describing them. Treat imperative requests as instructions to act now: do not ask for optional names or descriptions, and use sensible authored defaults when details are omitted. For requests to organize, tidy, align, evenly space, or stop objects overlapping, call canvas_arrange_objects without objectIds unless the user explicitly identified a subset. Omitting objectIds arranges the entire visible canvas even if the composer scope says selection; the tool uses measured object bounds and is safer than manually estimating x/y positions with canvas_set_object_layout. Requests to create or add an artifact on this Canvas must use canvas_add_object, even when an MCP tool has a similar resource name. Exception: a PRD belonging to a canonical project is durable project knowledge, not merely a visual artifact. For any request to create, consolidate, synthesize, or explain project PRDs or requirements, first call canvas_read_project_prds to read every ticket-linked PRD and its versions regardless of the current canvas selection. Then call canvas_create_project_prd with the complete synthesis; never use truncated task-card PRD summaries as the source and never use canvas_add_object for a project PRD. For example, "create a workflow" means call canvas_add_object with kind "workflow" and authored workflow fields; do not call builtin_workflows_create or ask a follow-up question. Use MCP tools for a mutation only when the user explicitly asks to create or change a canonical tenant resource outside the Canvas. For model requests, kind "llm" is a conventional language-model blueprint; kind "evermind" is BuilderForce's self-learning Evermind model with teach, train, evaluate, and publish capabilities. If the user says LLM, create kind "llm" unless they explicitly ask for Evermind or a continuously learning/self-updating model. Read each object's mutableFields before updating it. When creating an authored artifact, put the complete result in fields.content or fields.markdown and populate its other type-specific fields; do not create an empty shell. Canvas mutations are proposals the user reviews before they are applied. Never claim a mutation succeeded unless its tool result confirms it. Never emit tool_code, Python, or a simulated tool result in assistant text. Current canvas:\n${options.canvasSnapshot}${memoryBlock ? `\n\n${memoryBlock}` : ''}`,
    },
    ...(options.conversation || []).slice(-20).map((message) => ({ ...message, content: message.content.slice(0, 8_000) })),
    { role: 'user', content: options.prompt },
  ];
  const finish = async (answer: string): Promise<string> => {
    const text = answer.trim();
    if (!options.evermind || !text || text.length < 40 || !recalled) return answer;
    if (!recalled.seeded || recalled.mode === 'offline-frozen') {
      options.onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, skipped: true, reason: recalled.seeded ? 'frozen' : 'not-seeded' } });
      return answer;
    }
    try {
      const learned = await options.evermind.learn(text, options.prompt);
      if (learned.ok) {
        options.onTrace?.({ ts: new Date().toISOString(), category: 'learn', label: 'evermind.learn', result: { version: recalled.version, queued: learned.queued ?? true } });
        const reconciled = countReconciledMemories(recalled.items, text);
        if (reconciled) options.onTrace?.({ ts: new Date().toISOString(), category: 'reconcile', label: 'evermind.reconcile', result: { count: reconciled, version: recalled.version } });
      }
    } catch { /* Evermind learning is best-effort and must not fail the canvas turn. */ }
    return answer;
  };
  let finalText = '';
  let proposedCanvasMutation = false;
  let lastToolError = '';
  for (let turn = 0; turn < 3; turn += 1) {
    const result = await streamChatCompletion({
      transport,
      messages,
      tools: specsFor(actions),
      tool_choice: 'auto',
      maxTokens: 1600,
      reasoning: { level: 'low' },
      model: options.model,
      modelStrict: options.modelStrict,
      routingMode: options.routingMode,
    }, { onTextDelta: (delta) => { finalText += delta; options.onText?.(finalText); } });
    if (!result.toolCalls.length) return finish(result.text || finalText);
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
      } else if (!call.name.startsWith('canvas_') && mutates(action, args) && !options.autoApprove) {
        const approved = options.confirmAction ? await options.confirmAction({ name: call.name, args }) : false;
        if (!approved) outcome = { error: options.confirmAction ? 'The user declined this tenant mutation.' : 'This tenant mutation requires in-app approval.' };
        else {
          try { outcome = await action.run(args); } catch (error) { outcome = { error: error instanceof Error ? error.message : 'Tool failed' }; }
        }
      } else {
        try { outcome = await action.run(args); } catch (error) { outcome = { error: error instanceof Error ? error.message : 'Tool failed' }; }
      }
      if (outcome && typeof outcome === 'object') {
        const result = outcome as { proposed?: unknown; error?: unknown };
        if (result.proposed === true) proposedCanvasMutation = true;
        if (typeof result.error === 'string' && result.error.trim()) lastToolError = result.error.trim();
      }
      options.onTrace?.({ ts: new Date().toISOString(), category: outcome && typeof outcome === 'object' && 'error' in outcome ? 'error' : 'tool', label: call.name, args, result: outcome, isError: !!(outcome && typeof outcome === 'object' && 'error' in outcome) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) });
    }
    finalText = '';
  }
  if (finalText.trim()) return finish(finalText);
  if (proposedCanvasMutation) return finish('I prepared the canvas changes for review.');
  if (lastToolError) return finish(`I couldn't prepare the requested canvas changes: ${lastToolError}`);
  return finish("I couldn't prepare any canvas changes from that request.");
}
