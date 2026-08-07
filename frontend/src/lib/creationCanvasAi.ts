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
  type ChatMode,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestRoomApi';

type CanvasAiOptions = {
  prompt: string;
  /** Stable across every agent/model iteration caused by one composer submit. */
  guestTurnId?: string;
  /** Original composer text when this is an internal specialist/synthesis call. */
  guestTurnInput?: string;
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
  /**
   * The session's MODE (migration 0409) — `chat` (author on the canvas and answer) or
   * `work` (turn the conclusion into a tracked, dispatched ticket). Defaults to `chat`,
   * so a canvas turn never opens board work unless the user armed Work.
   */
  mode?: ChatMode;
  /** The canonical project this session is bound to, when it has one. Work mode needs
   *  it to file the ticket somewhere; absent, the model is told to ask for one. */
  projectId?: number | null;
};

/**
 * The MODE block for a canvas turn.
 *
 * The Canvas is not a Brain chat — it has no `chatId`, so it cannot use the shared
 * `chatModeDirective` (whose whole contract is "tie this to chat #N"). What carries
 * over is the DISTINCTION: chat authors on the board and answers; work leaves a
 * tracked, dispatched ticket behind. Tool names are the ADVERTISED `builtin_*` names
 * the model is actually given — a catalog id here would name a tool that appears
 * nowhere in its tool list (see api/scripts/check-prompt-tool-names.mjs).
 */
function canvasModeDirective(mode: ChatMode, projectId: number | null | undefined): string {
  if (mode !== 'work') {
    return 'MODE: CHAT. This session is a working conversation on the canvas. Author, refine and explain the objects the user asks for, and answer their questions. Do NOT create board tickets, assign owners, or dispatch agent runs as a side effect — unless the user explicitly asks for that in this message. If something clearly ought to be tracked as work, say so in one line and leave the decision to them.';
  }
  const target = projectId != null
    ? `Use project ${projectId} unless the user names another.`
    : 'This session is not bound to a project yet — ask which project the work belongs to before creating anything, and do not guess.';
  return (
    'MODE: WORK. This session exists to get something DONE, not only to draw it. Carry the work through to a running agent.\n'
    + `• When the canvas work implies something that must actually happen, create the ticket with builtin_tasks_create (exactly one assignee, taskType "task", "epic" or "gap"). ${target}\n`
    + '• Scope it before reporting success: builtin_kanban_participants for the template manifest, builtin_kanban_assess_resource for each role the description implies, then builtin_kanban_accountability, and report any unstaffed gaps plainly.\n'
    + '• FINISH BY DISPATCHING. builtin_tasks_create and builtin_tasks_update return an `autoRun` verdict — read it. If `autoRun.dispatched` is true, name the agent that picked the work up. If it is false, start the work yourself with builtin_kanban_coordinate, which dispatches the next required role-capable participant. If dispatch is refused, report the EXACT reason the tool returned and what would clear it.\n'
    + '• Never imply work has begun when nothing was dispatched, and never describe a tool call you did not make. Mirror the created ticket back onto the canvas with canvas_add_object so the board and the canvas agree.'
  );
}

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

const CREATION_CLAIM = /\b(?:i(?:'ve| have)?\s+(?:created|added|built|generated|updated|made|produced)|here(?:'s| is)\s+(?:the|a|your)|the\s+\w+\s+(?:has been|is now)\s+(?:created|added|updated))\b/i;
const CREATED_ARTIFACT = /\b(table|chart|graph|dashboard|kpi|visuali[sz]ation|report|document|slide|drawing|diagram|widget|object|card)\b/i;
/** Values the model may only state when a tool actually computed them. */
const FABRICATED_DATA = /\b(?:placeholder|sample|example|illustrative|dummy|mock|assumed|estimated|representative)\s+(?:value|number|figure|data|count|metric|row)s?\b/i;

/**
 * A canvas turn is only honest if the artifact it describes exists. The model
 * occasionally narrates a finished table or chart without calling a tool, which
 * previously reached the user as a success message beside an unchanged canvas.
 */
function unverifiedCreationClaim(text: string, mutated: boolean, hasTabularData: boolean): string | null {
  const answer = text.trim();
  if (!answer) return null;
  if (!mutated && CREATION_CLAIM.test(answer) && CREATED_ARTIFACT.test(answer)) {
    return `I described a canvas change but did not actually make one, so nothing was created. ${hasTabularData ? 'Ask me again and I will query the dataset on this canvas and build the artifact from its real values.' : 'Tell me which object to create and I will build it on the canvas.'}`;
  }
  if (hasTabularData && FABRICATED_DATA.test(answer)) {
    return `${answer}\n\nThose figures are not real: this canvas has an imported dataset, so I should have computed the values from it instead of using placeholders. Ask me to rebuild this and I will query every row.`;
  }
  return null;
}

/** True when the canvas holds an object with imported rows Brain could query. */
function snapshotHasTabularRows(snapshot: string): boolean {
  try {
    const parsed = JSON.parse(snapshot) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return false;
    return parsed.objects.some((value) => {
      if (!value || typeof value !== 'object') return false;
      const object = value as { kind?: unknown; rowCount?: unknown; sampleRows?: unknown };
      return ['dataset', 'table', 'spreadsheet'].includes(String(object.kind))
        && (Number(object.rowCount) > 0 || (Array.isArray(object.sampleRows) && object.sampleRows.length > 0));
    });
  } catch {
    return false;
  }
}

/**
 * A guest turn could not start because no guest token could be obtained. Thrown
 * as a TYPE rather than a message so the surface can say it in the visitor's own
 * language — this path is reachable from the public landing canvas, where a raw
 * English string would be the first thing the product ever says to them.
 */
export class GuestAiUnavailableError extends Error {
  readonly code = 'guest-ai-unavailable' as const;
  constructor() {
    super('guest-ai-unavailable');
    this.name = 'GuestAiUnavailableError';
  }
}

/** Run a small, bounded agent loop over the active canvas and shared MCP catalog. */
export async function runCreationCanvasAi(options: CanvasAiOptions): Promise<string> {
  if (options.persistence === 'local' && !(await ensureGuestToken())) {
    throw new GuestAiUnavailableError();
  }
  const config = options.persistence === 'server' ? brainConfig : guestBrainConfig;
  const transport = config.transport;
  const guestTurnId = options.guestTurnId ?? crypto.randomUUID();
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
      content: 'Creative objects are first-class, provider-neutral Builderforce Canvas widgets. Use image, animation, podcast, comic, game, cad, model3d, resume, template, video, document, or slides according to the requested output. Author the brief and configuration into the widget first. Use the built-in builtin_creative_capabilities tool to discover the native contract and builtin_creative_compose to normalize a creative manifest, then mirror the returned fields into the same Canvas object with canvas_update_object. Do not require, name, or assume any external product or provider. Never claim a rendered or exported deliverable exists unless a native execution result confirms it.',
    },
    {
      role: 'system',
      content: `${participantDirective}\n\nYou are operating BuilderForce's unified creation canvas. Use the provided canvas_* function tools to make requested visual changes instead of writing code or merely describing them. Treat imperative requests as instructions to act now: do not ask for optional names or descriptions, and use sensible authored defaults when details are omitted. A correction, complaint, question about a displayed value, or request to change labels on an existing/selected object is an UPDATE: call canvas_update_object on that object. Never create a replacement or duplicate unless the user explicitly asks for a new, additional, copied, or duplicated object. Never edit the Brain chat object merely to echo the conversation. For requests to organize, tidy, align, evenly space, or stop objects overlapping, call canvas_arrange_objects without objectIds unless the user explicitly identified a subset. Omitting objectIds arranges the entire visible canvas even if the composer scope says selection; the tool uses measured object bounds and is safer than manually estimating x/y positions with canvas_set_object_layout. Requests to create or add an artifact on this Canvas must use canvas_add_object, even when an MCP tool has a similar resource name. When asked to build, evaluate, test, or deliver an agent, create an operable package rather than an empty Agent card: include at least one authored knowledge, document, dataset, file, or URL object connected to the agent, and an Evaluation object with concrete test criteria. Put a representative test prompt and comma-separated expected response signals in the Agent's testPrompt and testExpected fields so the inspector can run and score it. Sales is the canonical exception: on a sales canvas, use builtin_sales_workspace_get to read the shared CRM and use the builtin_sales_* MCP tools for contacts, campaigns, goals, and coaching, because those records must be visible to the associate and superadmin. After a successful sales mutation, mirror the returned canonical id and current values into the matching salesContact, salesCampaign, salesGoal, or salesPipeline canvas object using canvas_add_object or canvas_update_object. Carry ownerUserId from the sales canvas object when a superadmin is collaborating. Use builtin_meetings_schedule for actual calendar meeting creation and mirror the result into a salesMeeting object. Exception: a PRD belonging to a canonical project is durable project knowledge, not merely a visual artifact. For any request to create, consolidate, synthesize, or explain project PRDs or requirements, first call canvas_read_project_prds to read every ticket-linked PRD and its versions regardless of the current canvas selection. Then call canvas_create_project_prd with the complete synthesis; never use truncated task-card PRD summaries as the source and never use canvas_add_object for a project PRD. For example, "create a workflow" means call canvas_add_object with kind "workflow" and authored workflow fields; do not call builtin_workflows_create or ask a follow-up question. Use MCP tools for a mutation only when the user explicitly asks to create or change a canonical tenant resource outside the Canvas, or when operating canonical sales data as described above. When the user asks to actually BUILD a website, web app, or mobile app — real code they can run, preview, and publish — create kind "build" and set fields.modality to the project type ("designer" for a website or web app, "mobile" for a phone app, "webmobile" for both from one codebase). A "build" object owns a real IDE workspace seeded with a runnable starter project; the user opens it from the details panel to edit files, run a dev server, and publish. Kind "website" is the authored, single-page site concept (headline, body, call to action) and kind "prototype" is a non-code WYSIWYG mock — use those when the user is designing rather than coding. For model requests, kind "llm" is a conventional language-model blueprint; kind "evermind" is BuilderForce's self-learning Evermind model with teach, train, evaluate, and publish capabilities. If the user says LLM, create kind "llm" unless they explicitly ask for Evermind or a continuously learning/self-updating model. Read each object's mutableFields before updating it. When creating an authored artifact, put the complete result in fields.content or fields.markdown and populate its other type-specific fields; do not create an empty shell. An explanatory visual must contain real renderable data: prefer a chart with chartLabels and chartValues, or for kind "drawing" supply fields.points with at least two {x,y} points plus drawingWidth and drawingHeight. Never create a blank drawing or visual placeholder. Data on this canvas is real and computable: when a dataset, table, or spreadsheet object is present, every count, total, percentage, ranking, comparison, chart value, and table row must come from canvas_query_dataset, which runs over all imported rows rather than the small sample shown in the snapshot. It is a failure to invent, estimate, illustrate, or use placeholder or example figures, and a failure to ask the user to connect or populate data that is already on the canvas. To build the artifact, call canvas_query_dataset with materializeAs "table", "chart", "dashboard", or "kpi" instead of retyping rows into canvas_add_object; use derive to compute a classification column such as success versus failure, groupBy to split it, and highlight to colour table rows. If the requested columns do not exist, read the dataset’s profile and columns from the snapshot and say which columns are actually available. A request to visualize, compare, map, or analyse a real-world subject the canvas does not already hold is a RESEARCH request, and research is a pipeline, not a single answer: search the web with builtin_web_search, read the promising sources with builtin_web_fetch, and create a Dataset object holding one row per entity with the columns you actually found, citing the source URLs in sources. Do not answer from memory, do not invent rows, and do not skip the Dataset — the dataset is the evidence the visual is built from, and a chart with no dataset behind it cannot be checked. Then build the visual from that dataset with canvas_query_dataset, never by retyping values into canvas_add_object. When the subject is geographic — places, regions, districts, cities, states, countries, sites, stores, offices — the visual is a Map: resolve the place names with builtin_geo_geocode, write the returned lat and lng back onto the dataset rows with canvas_update_object so every row carries coordinates, then call canvas_query_dataset with materializeAs "map". Pass builtin_geo_geocode's boundingBox for the enclosing region as mapRegion and its outline as mapOutline so the plot is framed by the real region, set mapValueColumn to whatever the user is comparing, and carry the returned attribution into mapAttribution. If builtin_web_search reports no key is connected, say so plainly, and build from what the user supplies or from a URL they paste rather than inventing the data. Non-destructive canvas authoring applies automatically; destructive, executable, and canonical actions remain proposals for user review. Never claim an object was updated unless canvas_update_object succeeded for that object's id; canvas_add_object means a new object was created. Never claim a mutation succeeded unless its tool result confirms it. Never emit tool_code, Python, or a simulated tool result in assistant text. Current canvas:\n${options.canvasSnapshot}${memoryBlock ? `\n\n${memoryBlock}` : ''}`,
    },
    // MODE (0409) — LAST of the system blocks so it is the nearest instruction to the
    // user's turn: it decides whether this turn may leave tracked, dispatched work
    // behind, and it must not be argued out of that by the long authoring block above.
    { role: 'system', content: canvasModeDirective(options.mode ?? 'chat', options.projectId) },
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
  const hasTabularData = snapshotHasTabularRows(options.canvasSnapshot);
  const verified = (answer: string): string => unverifiedCreationClaim(answer, proposedCanvasMutation, hasTabularData) ?? answer;
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
      metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
    }, { onTextDelta: (delta) => { finalText += delta; options.onText?.(finalText); } });
    if (!result.toolCalls.length) {
      if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
        return finish(incompleteDocumentAnswer(requestedPages, documentWords, documentWordCountExact));
      }
      return finish(verified(result.text || finalText));
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
  if (finalText.trim()) return finish(verified(finalText));
  if (proposedCanvasMutation) return finish('I added the requested content to the canvas.');
  if (lastToolError) return finish(`I couldn't prepare the requested canvas changes: ${lastToolError}`);
  return finish("I couldn't prepare any canvas changes from that request.");
}
