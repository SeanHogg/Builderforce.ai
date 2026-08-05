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
  /** Optional invited Canvas agent identity. The same bounded Canvas tool loop is
   * used, but the turn is authored from this specialist's configured perspective
   * instead of the session's coordinating Brain. */
  participant?: {
    ref: string;
    name: string;
    instructions?: string;
  };
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

const WORDS_PER_DRAFT_PAGE = 300;

function requestedDocumentPages(prompt: string): number | null {
  if (!/\b(?:create|generate|make|write|author|draft)\b/i.test(prompt)) return null;
  if (!/\b(?:document|doc|manuscript|book|report)\b/i.test(prompt)) return null;
  const match = prompt.match(/\b(\d[\d,]*)\s*(?:-|\s)?pages?\b/i);
  if (!match) return null;
  const pages = Number(match[1]!.replaceAll(',', ''));
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

function authoredDocumentWords(args: unknown): number | null {
  if (!args || typeof args !== 'object') return null;
  const input = args as { kind?: unknown; fields?: unknown };
  if (input.kind !== 'document' || !input.fields || typeof input.fields !== 'object') return null;
  const fields = input.fields as { markdown?: unknown; content?: unknown };
  const authored = [fields.markdown, fields.content].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  return authored ? (authored.match(/\S+/g) || []).length : 0;
}

function documentWordsInSnapshot(snapshot: string): number | null {
  try {
    const parsed = JSON.parse(snapshot) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return null;
    const counts = parsed.objects.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const object = value as { kind?: unknown; markdown?: unknown; content?: unknown };
      if (object.kind !== 'document') return [];
      const authored = [object.markdown, object.content].find((item) => typeof item === 'string' && item.trim()) as string | undefined;
      return [(authored?.match(/\S+/g) || []).length];
    });
    return counts.length ? Math.max(...counts) : null;
  } catch {
    return null;
  }
}

function requestedPagesForTurn(options: CanvasAiOptions): number | null {
  const direct = requestedDocumentPages(options.prompt);
  if (direct != null) return direct;
  if (!/\b(?:creating|created|done|finished|complete|status|progress|working)\b/i.test(options.prompt)) return null;
  for (const message of [...(options.conversation || [])].reverse()) {
    if (message.role !== 'user') continue;
    const pages = requestedDocumentPages(message.content);
    if (pages != null) return pages;
  }
  return null;
}

function incompleteDocumentAnswer(requestedPages: number, authoredWords: number, exact: boolean): string {
  if (!exact) {
    return `The canvas contains a document draft, but its authored content does not verify the requested ${requestedPages.toLocaleString('en-US')} pages. A manuscript that large cannot be authored in one bounded Brain turn, so it is not complete. Build and review it in sections before treating it as finished or exporting it.`;
  }
  const estimatedPages = Math.max(1, Math.ceil(authoredWords / WORDS_PER_DRAFT_PAGE));
  return `I created a document draft on the canvas with ${authoredWords.toLocaleString('en-US')} words (about ${estimatedPages.toLocaleString('en-US')} page${estimatedPages === 1 ? '' : 's'}), not the requested ${requestedPages.toLocaleString('en-US')} pages. A manuscript that large cannot be authored in one bounded Brain turn, so I have not marked it complete. Build and review it in sections before treating it as finished or exporting it.`;
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
  const participantDirective = options.participant
    ? `You are ${options.participant.name}, an invited specialist agent participating in this Creation Session. Contribute your own expert perspective, respond under your own identity, and coordinate with the other participants visible in the conversation. Use Canvas tools when your contribution should create or change an artifact. Do not pretend to be Brain or speak for another participant.${options.participant.instructions?.trim() ? ` Your configured instructions are:\n${options.participant.instructions.trim().slice(0, 8_000)}` : ''}`
    : 'You are Brain, the coordinating agent for this Creation Session. Synthesize participant perspectives, resolve disagreements explicitly, and turn the conversation into concrete Canvas artifacts.';
  const messages: ChatCompletionMessage[] = [
    {
      role: 'system',
      content: `${participantDirective}\n\nYou are operating BuilderForce's unified creation canvas. Use the provided canvas_* function tools to make requested visual changes instead of writing code or merely describing them. Treat imperative requests as instructions to act now: do not ask for optional names or descriptions, and use sensible authored defaults when details are omitted. A correction, complaint, question about a displayed value, or request to change labels on an existing/selected object is an UPDATE: call canvas_update_object on that object. Never create a replacement or duplicate unless the user explicitly asks for a new, additional, copied, or duplicated object. Never edit the Brain chat object merely to echo the conversation. For requests to organize, tidy, align, evenly space, or stop objects overlapping, call canvas_arrange_objects without objectIds unless the user explicitly identified a subset. Omitting objectIds arranges the entire visible canvas even if the composer scope says selection; the tool uses measured object bounds and is safer than manually estimating x/y positions with canvas_set_object_layout. Requests to create or add an artifact on this Canvas must use canvas_add_object, even when an MCP tool has a similar resource name. When asked to build, evaluate, test, or deliver an agent, create an operable package rather than an empty Agent card: include at least one authored knowledge, document, dataset, file, or URL object connected to the agent, and an Evaluation object with concrete test criteria. Put a representative test prompt and comma-separated expected response signals in the Agent's testPrompt and testExpected fields so the inspector can run and score it. Sales is the canonical exception: on a sales canvas, use sales.workspace_get to read the shared CRM and use sales.* MCP tools for contacts, campaigns, goals, and coaching, because those records must be visible to the associate and superadmin. After a successful sales mutation, mirror the returned canonical id and current values into the matching salesContact, salesCampaign, salesGoal, or salesPipeline canvas object using canvas_add_object or canvas_update_object. Carry ownerUserId from the sales canvas object when a superadmin is collaborating. Use meetings.schedule for actual calendar meeting creation and mirror the result into a salesMeeting object. Exception: a PRD belonging to a canonical project is durable project knowledge, not merely a visual artifact. For any request to create, consolidate, synthesize, or explain project PRDs or requirements, first call canvas_read_project_prds to read every ticket-linked PRD and its versions regardless of the current canvas selection. Then call canvas_create_project_prd with the complete synthesis; never use truncated task-card PRD summaries as the source and never use canvas_add_object for a project PRD. For example, "create a workflow" means call canvas_add_object with kind "workflow" and authored workflow fields; do not call builtin_workflows_create or ask a follow-up question. Use MCP tools for a mutation only when the user explicitly asks to create or change a canonical tenant resource outside the Canvas, or when operating canonical sales data as described above. For model requests, kind "llm" is a conventional language-model blueprint; kind "evermind" is BuilderForce's self-learning Evermind model with teach, train, evaluate, and publish capabilities. If the user says LLM, create kind "llm" unless they explicitly ask for Evermind or a continuously learning/self-updating model. Read each object's mutableFields before updating it. When creating an authored artifact, put the complete result in fields.content or fields.markdown and populate its other type-specific fields; do not create an empty shell. An explanatory visual must contain real renderable data: prefer a chart with chartLabels and chartValues, or for kind "drawing" supply fields.points with at least two {x,y} points plus drawingWidth and drawingHeight. Never create a blank drawing or visual placeholder. Non-destructive canvas authoring applies automatically; destructive, executable, and canonical actions remain proposals for user review. Never claim an object was updated unless canvas_update_object succeeded for that object's id; canvas_add_object means a new object was created. Never claim a mutation succeeded unless its tool result confirms it. Never emit tool_code, Python, or a simulated tool result in assistant text. Current canvas:\n${options.canvasSnapshot}${memoryBlock ? `\n\n${memoryBlock}` : ''}`,
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
  const requestedPages = requestedPagesForTurn(options);
  let documentWords: number | null = requestedPages == null ? null : documentWordsInSnapshot(options.canvasSnapshot);
  let documentWordCountExact = false;
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
    if (!result.toolCalls.length) {
      if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
        return finish(incompleteDocumentAnswer(requestedPages, documentWords, documentWordCountExact));
      }
      return finish(result.text || finalText);
    }
    messages.push({
      role: 'assistant', content: result.text,
      tool_calls: result.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })),
    });
    for (const call of result.toolCalls) {
      const action = byName.get(call.name);
      let args: unknown = {};
      try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }
      const words = call.name === 'canvas_add_object' ? authoredDocumentWords(args) : null;
      if (words != null) {
        documentWords = Math.max(documentWords ?? 0, words);
        documentWordCountExact = true;
      }
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
  if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
    return finish(incompleteDocumentAnswer(requestedPages, documentWords, documentWordCountExact));
  }
  if (finalText.trim()) return finish(finalText);
  if (proposedCanvasMutation) return finish('I added the requested content to the canvas.');
  if (lastToolError) return finish(`I couldn't prepare the requested canvas changes: ${lastToolError}`);
  return finish("I couldn't prepare any canvas changes from that request.");
}
