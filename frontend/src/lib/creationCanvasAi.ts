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
  turnInterruption,
} from '@seanhogg/builderforce-brain-embedded';
import { brainConfig } from '@/lib/brain/runtime';
import { guestBrainConfig } from '@/lib/brain/guestRuntime';
import { ensureGuestToken } from '@/lib/guestRoomApi';
import { GUEST_RESEARCH_ACTIONS } from '@/lib/guestResearchActions';
import { loadGuestCareerActions } from '@/lib/guestCareerActions';
import { conversationSpeakerLabels, echoesEarlierAnswer, stripSpeakerLabel } from '@/lib/canvasTranscript';
import {
  NON_AUTHORING_TOOL_NAMES,
  RESEARCH_TOOL_NAMES,
  WORDS_PER_DRAFT_PAGE,
  authoredDocumentWords,
  documentWordsInSnapshot,
  incompleteDocumentAnswer,
  isExecutiveTeammateRequest,
  isNarrowSearchResult,
  isWebsiteRedesignRequest,
  requestedPagesForTurn,
  requestsCanvasMutation,
  snapshotHasTabularRows,
  unverifiedCreationClaim,
} from '@/lib/canvasTurnOutcome';
import { founderCanvasSystemPrompt } from '@/lib/founderCanvasPrompt';
import type { CanvasNotices } from '@/lib/canvasNotices';

type CanvasAiOptions = {
  prompt: string;
  /** Stable across every agent/model iteration caused by one composer submit. */
  guestTurnId?: string;
  /** Original composer text when this is an internal specialist/synthesis call. */
  guestTurnInput?: string;
  canvasSnapshot: string;
  persistence: 'local' | 'server';
  canvasActions: BrainAction[];
  /**
   * Every sentence this turn can return that the MODEL did not write, already in the
   * viewer's language. Required, not defaulted: an English fallback here would be a
   * second source for text the catalogs own, and the notices reach the user as Brain
   * speaking (see `lib/canvasNotices.ts`).
   */
  notices: CanvasNotices;
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
  /** Session diagnostics hook. Contains routing facts only; never prompt text,
   * credentials, or provider response bodies. */
  onCompletion?: (completion: CanvasAiCompletion) => void;
  /** Models that already proved unable to execute a Canvas command in this
   * session. An explicitly selected rejected model must not be invoked again. */
  disabledModels?: readonly string[];
  onModelDisabled?: (model: string) => void;
  /** Fired when a command-stalled model is replaced by a model that already
   * demonstrated tool calling earlier in the same turn. */
  onModelFallback?: (model: string) => void;
  /**
   * Fired when the string this function returns is a RUNTIME NOTICE rather than
   * something the model actually said — the turn produced no answer, executed no
   * command, or died on a tool error.
   *
   * The surface needs this to keep the notice OUT of the session transcript. Storing
   * it as an assistant message is what let one failed turn poison every turn after it:
   * the next request carried "I couldn't prepare any canvas changes from that request"
   * as an example assistant reply, and a free model reproduced it verbatim instead of
   * answering (2026-08-12, ui 2026.7.210).
   */
  onUnanswered?: (outcome: { reason: 'no-answer' | 'command-not-executed' | 'tool-error'; detail?: string }) => void;
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

export interface CanvasAiCompletion {
  at: string;
  iteration: number;
  requestedModel: string | null;
  resolvedModel: string | null;
  resolvedVendor: string | null;
  account: string | null;
  routingMode: 'auto' | 'byo_pool';
  toolsAdvertised: number;
  toolCalls: string[];
  finishReason: string | null;
}

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


/**
 * Model round-trips one composer submit may take before the loop gives up.
 *
 * This was 3, which is enough to author an object and answer, and NOT enough to
 * research anything: the pipeline the system prompt below prescribes is search → fetch
 * a source → fetch another → create the Dataset → geocode it → materialize the visual,
 * so a research turn ran out of rounds mid-pipeline and returned a half-built board.
 * These extra rounds are tool continuations of ONE user turn — the guest allowance
 * charges per turn (idempotent on `guestTurnId`), so a deeper loop costs the visitor
 * nothing from their message budget.
 */
export const MAX_CANVAS_TOOL_TURNS = 8;

/** Keep enough of a bounded turn to author the requested Canvas artifacts after
 * research. Without this reservation, a model can spend all eight continuations
 * retrying a narrow search backend and never reach canvas_add_object. */
const RESERVED_AUTHORING_TURNS = 2;

/** Two encyclopedic results are enough evidence that repeating differently worded
 * searches will not produce the open-web design sources the user requested. */
const MAX_NARROW_SEARCHES = 2;

/** Comparison documents and implementation guidance routinely need more than the
 * former 1,600-token ceiling. The durable result still belongs in Canvas objects;
 * this prevents the user-facing handoff from ending in the middle of a sentence. */
const CANVAS_RESPONSE_TOKENS = 3_200;

/** Act-now escalations before the turn stops asking a stalled model to author. */
const MAX_MUTATION_RECOVERIES = 2;

/** An INTERRUPTED turn — truncated by the output ceiling, or a tool call the
 * provider could not parse — is retried with the instruction that matches the
 * interruption. Two per turn: enough to clear a one-off, few enough that a model
 * which cannot author inside the ceiling fails over instead of looping. */
const MAX_INTERRUPTED_TURN_RECOVERIES = 2;

/** Truncation is an OUTPUT-SIZE failure, so the recovery is to author smaller —
 * the opposite of "answer again", which would truncate identically. The canvas
 * itself is the durable place for length, so splitting across calls costs nothing. */
const TRUNCATED_TURN_DIRECTIVE = 'Your previous response was cut off at the output limit before it finished, so nothing you sent could be used. Produce less in one step: make ONE canvas_* tool call at a time with the fields that matter, keep prose short, and split a long artifact across several calls or several objects rather than sending it all at once.';

/** The model DID choose to act; the arguments were unparseable. Telling it to
 * "answer" here would discard a correct intent, so the directive keeps the action
 * and constrains only the encoding. */
const MALFORMED_TOOL_CALL_DIRECTIVE = 'Your previous tool call could not be parsed and was discarded. Make the same call again with strictly valid JSON arguments: no comments, no trailing commas, no unescaped newlines or quotes inside string values, and no placeholder text. Send one tool call.';

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
  if (options.model && options.disabledModels?.includes(options.model)) {
    throw new Error(`Model '${options.model}' is disabled for this session because it did not execute an earlier Canvas command.`);
  }
  // AUTOMATIC ROUTING IS NEVER REFUSED.
  //
  // This used to throw when auto-select had previously landed on a model that would
  // not execute a command, telling the user to "select a different model". On the free
  // plan there IS no model picker, and on a guest board the gateway deletes any pin the
  // client sends — so the advice named an action the user could not take, and every
  // later turn died in 30ms without reaching a model at all. One weak turn permanently
  // ended the session (measured 2026-08-12, ui 2026.7.212).
  //
  // The list is a ROUTING HINT now, not a veto: it rides the request as `excludeModels`,
  // which the gateway honours only while another candidate remains. Worst case the same
  // model answers again — strictly better than refusing to answer at all.
  const excludeModels = options.model ? [] : (options.disabledModels ?? []);
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
  // A logged-out board has no tenant and therefore no MCP catalog — which is where
  // research lives. Without these three the system prompt below names tools the guest
  // model was never given, and a "research X and chart it" turn resolves from the
  // model's weights instead of from sources. Same NAMES as the MCP ones on purpose
  // (see guestResearchActions), so one prompt is correct on both surfaces.
  const researchActions = options.persistence === 'server' ? [] : GUEST_RESEARCH_ACTIONS;
  // The same argument, one domain over: the career tools (résumé scoring, job match,
  // interview prep, runway) are pure over text the visitor supplies, so a guest gets the
  // IDENTICAL implementation a tenant does rather than a degraded imitation. Fetched
  // from the server catalog rather than re-declared here — see guestCareerActions.
  const careerActions = options.persistence === 'server' ? [] : await loadGuestCareerActions();
  const actions = [...options.canvasActions, ...mcpActions, ...researchActions, ...careerActions];
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
      content: `${participantDirective}\n\nYou are operating BuilderForce's unified creation canvas. Use the provided canvas_* function tools to make requested visual changes instead of writing code or merely describing them. Treat imperative requests as instructions to act now: do not ask for optional names or descriptions, and use sensible authored defaults when details are omitted. "Bring in", "add", or "invite" a named specialist or executive role means to call canvas_add_object to add an Agent with that role's perspective, then author the requested plan, review, forecast, or other useful deliverable as a separate object and connect it to the Agent with canvas_connect_objects. Use relevant existing canvas objects as context. On a new canvas, make a useful first pass with clearly stated assumptions and open questions inside the deliverable; never ask the user what "this" means and never merely repeat the request. A correction, complaint, question about a displayed value, or request to change labels on an existing/selected object is an UPDATE: call canvas_update_object on that object. Never create a replacement or duplicate unless the user explicitly asks for a new, additional, copied, or duplicated object. Never edit the Brain chat object merely to echo the conversation. For requests to organize, tidy, align, evenly space, or stop objects overlapping, call canvas_arrange_objects without objectIds unless the user explicitly identified a subset. Omitting objectIds arranges the entire visible canvas even if the composer scope says selection; the tool uses measured object bounds and is safer than manually estimating x/y positions with canvas_set_object_layout. Requests to create or add an artifact on this Canvas must use canvas_add_object, even when an MCP tool has a similar resource name. When asked to build, evaluate, test, or deliver an agent, create an operable package rather than an empty Agent card: include at least one authored knowledge, document, dataset, file, or URL object connected to the agent, and an Evaluation object with concrete test criteria. Put a representative test prompt and comma-separated expected response signals in the Agent's testPrompt and testExpected fields so the inspector can run and score it. Sales is the canonical exception: on a sales canvas, use builtin_sales_workspace_get to read the shared CRM and use the builtin_sales_* MCP tools for contacts, campaigns, goals, and coaching, because those records must be visible to the associate and superadmin. After a successful sales mutation, mirror the returned canonical id and current values into the matching salesContact, salesCampaign, salesGoal, or salesPipeline canvas object using canvas_add_object or canvas_update_object. Carry ownerUserId from the sales canvas object when a superadmin is collaborating. Use builtin_meetings_schedule for actual calendar meeting creation and mirror the result into a salesMeeting object. Exception: a PRD belonging to a canonical project is durable project knowledge, not merely a visual artifact. For any request to create, consolidate, synthesize, or explain project PRDs or requirements, first call canvas_read_project_prds to read every ticket-linked PRD and its versions regardless of the current canvas selection. Then call canvas_create_project_prd with the complete synthesis; never use truncated task-card PRD summaries as the source and never use canvas_add_object for a project PRD. For example, "create a workflow" means call canvas_add_object with kind "workflow" and authored workflow fields; do not call builtin_workflows_create or ask a follow-up question. A workflow's steps are EXECUTABLE, not labels: fields.steps must be an array of objects where every step carries the call it makes, not just a name. For an integration step set connector and action to real catalog keys plus an input object — for example {"title":"Send the SMS","connector":"twilio","action":"send_sms","input":{"To":"{{input.To}}","From":"+15550001111","Body":"..."}}. For a model step set prompt (and optionally provider and model); for an agent step set role and task. Never author a step that has only a title: a title-only step is rejected at build time as underspecified, and inventing plausible stage names such as "Audience" or "Approve" for a request that did not ask for them is a failure. Call builtin_connectors_actions to read the real connector and action keys before authoring an integration step rather than guessing them. After authoring the steps, invoke the object's "build" action with canvas_invoke_object_action to compile them into a real, runnable workflow definition; "run" builds first when needed. Build returns per-step issues when a step is not runnable — fix the named steps and build again. Never tell the user a workflow is complete, configured, or ready to run before a build has succeeded. Use MCP tools for a mutation only when the user explicitly asks to create or change a canonical tenant resource outside the Canvas, or when operating canonical sales data as described above. A Website or WYSIWYG request must create or update kind "website" or "prototype" with fields.pages containing real page objects and authored sections. Every page has {id,name,path,sections}; sections use hero, features, content, stats, testimonial, or cta. Author a hero with heading, body, and cta plus at least one additional section, and choose fields.websiteTheme.style from editorial, bold, minimal, soft, or technical based on the user's subject. Never rely on default ecommerce copy or create a titled shell. Follow-up content, page, navigation, style, or CTA requests must update the selected website's pages with canvas_update_object. When the user asks to actually BUILD a website, web app, or mobile app — real code they can run, preview, and publish — also create kind "build" and set fields.modality to the project type ("designer" for a website or web app, "mobile" for a phone app, "webmobile" for both from one codebase). A "build" object owns a real Canvas Builder workspace seeded with a runnable starter project; the user opens it directly on Canvas to edit files, run a dev server, and publish. Kind "website" and kind "prototype" are rendered through the same structured non-code WYSIWYG surface. For model requests, kind "llm" is a conventional language-model blueprint; kind "evermind" is BuilderForce's self-learning Evermind model with teach, train, evaluate, and publish capabilities. If the user says LLM, create kind "llm" unless they explicitly ask for Evermind or a continuously learning/self-updating model. Read each object's mutableFields before updating it. When creating an authored artifact, put the complete result in fields.content or fields.markdown and populate its other type-specific fields; do not create an empty shell. An explanatory visual must contain real renderable data: prefer a chart with chartLabels and chartValues, or for kind "drawing" supply fields.points with at least two {x,y} points plus drawingWidth and drawingHeight. Never create a blank drawing or visual placeholder. Data on this canvas is real and computable: when a dataset, table, or spreadsheet object is present, every count, total, percentage, ranking, comparison, chart value, and table row must come from canvas_query_dataset, which runs over all imported rows rather than the small sample shown in the snapshot. It is a failure to invent, estimate, illustrate, or use placeholder or example figures, and a failure to ask the user to connect or populate data that is already on the canvas. To build the artifact, call canvas_query_dataset with materializeAs "table", "chart", "dashboard", or "kpi" instead of retyping rows into canvas_add_object; use derive to compute a classification column such as success versus failure, groupBy to split it, and highlight to colour table rows. If the requested columns do not exist, read the dataset’s profile and columns from the snapshot and say which columns are actually available. A request to visualize, compare, map, or analyse a real-world subject the canvas does not already hold is a RESEARCH request, and research is a pipeline, not a single answer: search the web with builtin_web_search, read the promising sources with builtin_web_fetch, and create a Dataset object holding one row per entity with the columns you actually found, citing the source URLs in sources. Do not answer from memory, do not invent rows, and do not skip the Dataset — the dataset is the evidence the visual is built from, and a chart with no dataset behind it cannot be checked. Then build the visual from that dataset with canvas_query_dataset, never by retyping values into canvas_add_object. When the subject is geographic — places, regions, districts, cities, states, countries, sites, stores, offices — the visual is a Map: resolve the place names with builtin_geo_geocode, write the returned lat and lng back onto the dataset rows with canvas_update_object so every row carries coordinates, then call canvas_query_dataset with materializeAs "map". Pass builtin_geo_geocode's boundingBox for the enclosing region as mapRegion and its outline as mapOutline so the plot is framed by the real region, set mapValueColumn to whatever the user is comparing, and carry the returned attribution into mapAttribution. builtin_web_search always works — no key or account is required — so a research request is never a reason to answer from memory. Its result carries a "coverage" field: when that is "encyclopedic" the index behind it is narrower than a general web engine, so cite exactly what you found, say plainly which entities you could not find sources for rather than filling them in yourself, and mention that connecting a Tavily, Exa, or Linkup key under Settings → Integrations — or pointing the deployment at a self-hosted SearXNG instance — widens the search to the open web. If a search or fetch does fail, say what failed and build from what the user supplies or from a URL they paste rather than inventing the data. Non-destructive canvas authoring applies automatically; destructive, executable, and canonical actions remain proposals for user review. Never claim an object was updated unless canvas_update_object succeeded for that object's id; canvas_add_object means a new object was created. Never claim a mutation succeeded unless its tool result confirms it. Never emit tool_code, Python, or a simulated tool result in assistant text. NEVER STATE THAT SOMETHING IS NOT ON THE CANVAS WITHOUT CHECKING FIRST. The detailed objects below may be a SCOPED SUBSET of the board — read scopeNote. boardInventory always lists every object on the board with its title and file name; before you say a file or object is missing, absent, not present, or "the only object present is X", look it up with canvas_read_object (which tolerates a wrong extension and a partial name) or read the whole board with canvas_read_snapshot. Telling someone to upload a file that is already on their board is a failure, not a clarifying question. When an object exists but its detail was outside this turn's scope, read it and answer — do not ask the user to re-select it. Current canvas:\n${options.canvasSnapshot}${memoryBlock ? `\n\n${memoryBlock}` : ''}`,
    },
    ...(isWebsiteRedesignRequest(options.prompt) ? [{
      role: 'system',
      content: 'Website redesign research has a concrete completion contract. Fetch the supplied website first. For comparison brands whose official homepage URL is known, fetch that URL directly instead of searching for commentary about its design. If two searches return encyclopedic coverage, stop searching; do not retry with synonyms. Before answering, create or update the proposed website/prototype and create a document containing the sourced current-versus-proposed comparison plus prioritized step-by-step implementation guidance. A generic SaaS-principles summary is not completion.',
    } satisfies ChatCompletionMessage] : []),
    {
      role: 'system',
      content: 'For a Twilio AI journey request, inspect the whole board before authoring and update/reuse matching Twilio objects instead of duplicating them. Produce one coherent, reusable customer journey: a specific persona and before/after outcome; an executable workflow where a visible LLM/agent decision directly leads to a real action on the existing twilio connector; approval, failure, and production-readiness details; a lightweight architecture diagram; an evidence-based quality evaluation covering creativity, long-term end-user impact, market potential, and technical feasibility; a concise live-demo script; measurable success evidence; an Idea-to-Real website handoff that uses the existing BuilderForce Embedded install path at /embedded and documents the host script, chosen customer-site capability, identity/events, and acceptance test; and one guidedTour object whose targetObjectId values point at the actual objects created or reused, including the embed handoff. Never create a connector object: Canvas exposes the canonical Twilio connection settings when the workflow needs them. Never invent a second embed SDK or iframe contract: use the existing BuilderForce Embedded capability and its generated workspace key/snippets. Prefer one strong workflow over separate generic SMS and Voice workflows unless the user explicitly asks for multiple channels. Do not name the experience after a contest or create competition-application artifacts unless the user explicitly asks for them.',
    },
    // PICTURES, AND THE CAPABILITIES THE MODEL DENIES HAVING.
    //
    // Named separately from the enormous authoring block above because that block's only
    // visual instruction — "for kind 'drawing' supply fields.points with at least two
    // {x,y} points" — aimed every picture request at the one tool that cannot serve one.
    // Measured 2026-08-12 (ui 2026.7.213), "draw me a coniferous landscape at <address>":
    // two refused `canvas_add_object` drawing calls, zero image calls, and the session
    // ending on "I cannot generate images" and "I cannot open a map" — both false, with
    // `canvas_add_image`, `builtin_geo_geocode` and `builtin_web_fetch` in the tool list.
    // A model that has been handed a capability must never disclaim it, and a model that
    // has been refused one must relay the refusal it was actually given.
    {
      role: 'system',
      content: 'PICTURES. A request to draw, sketch, render, illustrate, paint, mock up, "show me what it looks like", or otherwise produce a picture is a request for REAL PIXELS: call canvas_add_image — mode "generate" to create the picture, mode "find" to search real photography. Do that FIRST, before writing any note or plan about the subject, and do it without asking permission. Kind "drawing" holds vector {x,y} points you author yourself and kind "chart" holds plotted values; neither can hold a picture, neither is a fallback for one, and offering one to the user as though it were is a failure. NEVER tell the user you are unable to generate, render, view, look up or picture something. If a capability is gated, the tool result states the exact reason — relay THAT reason and what clears it, and never invent a limitation of your own. A street address, place, landmark or region IS resolvable: builtin_geo_geocode returns its coordinates and bounding box, and builtin_web_search plus builtin_web_fetch read what is published about it. Look it up before you say you cannot.',
    },
    // SOCIAL, AND THE POSTS A MODEL MUST NOT INVENT.
    //
    // Named separately for the same reason PICTURES is: the authoring block above tells
    // the model to answer with authored objects, and "how are our socials doing?" is the
    // one shape of request where an authored object is a LIE — the numbers exist, in the
    // tenant's connected accounts, and a plausible-looking invented feed is worse than
    // no answer. The publish half is the mirror image: it reaches the public and cannot
    // be taken back, so drafting and publishing are two separate, explicit acts.
    {
      role: 'system',
      content: 'SOCIAL. A request to see, review, analyse or report on social media, posts, channels or engagement is a request for the workspace\'s REAL accounts: call canvas_add_social_feed (or canvas_refresh_social_feed when a feed tile is already on the board) and answer from what it returns. Never invent posts, follower counts or engagement numbers, and never build a chart of made-up social metrics — the tool reads X, LinkedIn, Facebook, Instagram and TikTok directly. Use canvas_pin_social_post to lift one post out for discussion. A request to announce, promote or "post about" something is canvas_create_social_campaign: it drafts one announcement, with per-network variants where the wording should differ, and puts it on the board WITHOUT publishing. Publishing is a separate, explicit act — canvas_publish_social_campaign — that is public and cannot be undone: confirm with the user first, and never call it speculatively or to test. Instagram and TikTok cannot publish text alone; if there is no image or video URL, say so rather than letting those networks be skipped silently. If no account is connected the tool says so and names where to connect one — relay that instead of inventing a limitation.',
    },
    // THE FOUNDER OBJECTS, AND THE ANALYSIS THAT MUST NOT LAND AS PROSE.
    // Content lives in `founderCanvasPrompt.ts`, which explains itself and composes its
    // field contract from the object registry.
    { role: 'system', content: founderCanvasSystemPrompt() },
    // ANONYMOUS CANVAS. The blocks above describe the full product, including tools
    // that only exist for a signed-in tenant (`canvas_read_project_prds`,
    // `canvas_create_project_prd`, a connected mailbox). On a guest board those are
    // neither advertised nor accepted, so without this the model is reading instructions
    // about tools it does not have — which is how "connect my email" produced a bare
    // refusal instead of the one useful answer available.
    //
    // `canvas_add_image` is deliberately NOT in that list any more. It is advertised on
    // every board and gates itself with the reason (see the guest-gated set in
    // `@builderforce/creation-canvas-contract`), because a stripped image tool is what
    // made the model invent a drawing-tool limitation instead of naming the account.
    ...(options.persistence === 'local' ? [{
      role: 'system',
      content: 'This is an ANONYMOUS canvas: it is saved on this device and has no account behind it. You still have the full local authoring, layout, dataset, diagnostics and web-research tools, and you must use them. What you do NOT have is anything that reads a tenant: a connected mailbox or inbox, connected social accounts, canonical project PRDs, and tenant domain data. Server-side work such as image generation IS in your tool list and will tell you itself when it needs an account — call it and relay what it says rather than guessing in advance. When a request needs an account — connecting an email account, sending from their mailbox, reading their company data, producing a real image — do BOTH of these in the same turn: say in one sentence that it needs a free account and where it is unlocked, and then build the part you CAN build on the canvas now (the campaign plan, the audience definition, the message drafts, the planting layout, the workflow) with canvas_add_object. Never answer a request like that with a refusal alone, never describe it as a technical limitation, and never claim you connected or created something you did not.',
    } satisfies ChatCompletionMessage] : []),
    // ANSWER DISCIPLINE. Cheap free-pool models handed a labelled transcript reproduce
    // the previous assistant line verbatim instead of answering (measured 2026-08-12:
    // 15 completion tokens, zero tool calls, the reply being the prior reply with a
    // "Brain: " prefix). Both halves of that failure are named here explicitly.
    {
      role: 'system',
      content: 'Answer the user\'s latest message. Never repeat, quote back, or lightly reword an earlier assistant message in this conversation as your reply — an earlier reply, including one that reported a failure, is never the answer to a new request. Never begin your reply with a speaker name or role label such as "Brain:"; write the answer itself.',
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
  let executiveRequestRecoveryUsed = false;
  /** Act-now escalations spent on a model that answered in prose instead of calling a
   *  canvas tool. Two: the first re-states the command, the second runs with research
   *  and board re-reads already withdrawn and tells it why prose is not an artifact. */
  let mutationRecoveries = 0;
  let degenerateAnswerRecoveryUsed = false;
  let interruptedTurnRecoveries = 0;
  let authoringDirectiveIssued = false;
  let narrowSearches = 0;
  let lastToolError = '';
  /**
   * The most recent real thing the model SAID this turn — non-empty, not an echo of an
   * earlier reply. Held across iterations because the recovery paths deliberately clear
   * `finalText` before continuing, and one of them then gives up: without this, an
   * answer the model actually produced is unrecoverable by the time the loop ends.
   */
  let lastSpokenAnswer = '';
  let activeModel = options.model;
  let activeModelStrict = options.modelStrict;
  const toolCallingModels: string[] = [];
  const commandFailedModels = new Set(options.disabledModels ?? []);
  /** Labels this session's transcript uses, so a copied `Brain: ` prefix can be
   *  recognised and removed without touching an answer that legitimately opens with
   *  a colon. */
  const speakerLabels = conversationSpeakerLabels(options.conversation, [options.participant?.name]);
  /**
   * Retire the model that just failed to produce a usable turn and continue on one
   * that already emitted valid tool calls in this same turn.
   *
   * Shared by BOTH give-up paths (a command the model would not execute, and an
   * empty/echoed answer) — they differ only in what they tell the replacement model.
   * Returns false when no proven model is left, which is the caller's signal to stop.
   */
  const switchToProvenModel = (failedModel: string | null | undefined, directive: string): boolean => {
    const alreadyFailed = failedModel ? new Set([...commandFailedModels, failedModel]) : commandFailedModels;
    const fallback = [...toolCallingModels].reverse().find((model) => !alreadyFailed.has(model));
    if (!fallback || (fallback === activeModel && activeModelStrict === true)) {
      // NOTHING TO SWITCH TO. Do NOT record the failure in that case: the record's
      // only purpose is to route around the model on a later turn, and a session that
      // has no alternative gains nothing from it while paying the full price — the
      // list is session-scoped, so one weak turn used to end the session outright.
      // Release the pin instead, so the next iteration asks the gateway to choose
      // again rather than re-pinning the model that just failed.
      activeModel = options.model;
      activeModelStrict = options.modelStrict;
      return false;
    }
    if (failedModel) {
      commandFailedModels.add(failedModel);
      options.onModelDisabled?.(failedModel);
    }
    activeModel = fallback;
    activeModelStrict = true;
    mutationRecoveries = 0;
    degenerateAnswerRecoveryUsed = false;
    interruptedTurnRecoveries = 0;
    options.onModelFallback?.(fallback);
    messages.push({ role: 'system', content: `${directive} Continue on ${fallback}, which already emitted valid tool calls in this turn.` });
    return true;
  };
  const notices = options.notices;
  const mutationRequested = !options.participant && requestsCanvasMutation(options.prompt);
  const hasTabularData = snapshotHasTabularRows(options.canvasSnapshot);
  // An informational question is allowed to mention documents, reports, charts,
  // and other artifact nouns. Running the mutation-claim detector on every answer
  // turned ordinary replies such as "here is the standard document format" into
  // "I described a canvas change but did not make one." Only enforce this contract
  // when the user's request actually asked Canvas to create or update something.
  const verified = (answer: string): string =>
    unverifiedCreationClaim(notices, answer, proposedCanvasMutation, hasTabularData, mutationRequested) ?? answer;
  const requestedPages = requestedPagesForTurn(options);
  let documentWords: number | null = requestedPages == null ? null : documentWordsInSnapshot(options.canvasSnapshot);
  let documentWordCountExact = false;
  for (let turn = 0; turn < MAX_CANVAS_TOOL_TURNS; turn += 1) {
    // The authoring phase arms on EITHER trigger. Turn count alone made it unreachable
    // for the failure it exists to stop: a model that answers in prose instead of
    // calling a tool is told once to act, ignores it, and the loop gives up on turn 4 —
    // three turns before the reserved window it never reaches. Having already ignored
    // an explicit act-now directive is the stronger signal of the two, so it arms the
    // same phase: research and re-reads withdrawn, authoring tools only.
    const authoringOnly = mutationRequested && !proposedCanvasMutation
      && (mutationRecoveries > 0 || MAX_CANVAS_TOOL_TURNS - turn <= RESERVED_AUTHORING_TURNS);
    if (authoringOnly && !authoringDirectiveIssued) {
      authoringDirectiveIssued = true;
      messages.push({
        role: 'system',
        content: 'The research phase is over. Use the remaining turns only to create or update the requested Canvas artifacts with canvas_* tools. Build from what you already have — you have the board snapshot and do not need to read it again — state any evidence gap inside the artifact, and do not make another search or fetch call.',
      });
    }
    const availableActions = authoringOnly
      ? actions.filter((action) => !NON_AUTHORING_TOOL_NAMES.has(action.name))
      : actions;
    const result = await streamChatCompletion({
      transport,
      messages,
      tools: specsFor(availableActions),
      tool_choice: 'auto',
      maxTokens: CANVAS_RESPONSE_TOKENS,
      reasoning: { level: 'low' },
      model: activeModel,
      modelStrict: activeModelStrict,
      routingMode: options.routingMode,
      // Models this session (or this turn) already proved will not execute a Canvas
      // command. Only meaningful while UNPINNED — with a pin the caller has made the
      // choice — and the gateway ignores it rather than emptying the cascade, so this
      // can steer routing without ever refusing to answer.
      ...(!activeModel && (excludeModels.length || commandFailedModels.size)
        ? { excludeModels: [...new Set([...excludeModels, ...commandFailedModels])] }
        : {}),
      metadata: { guestTurnId, guestTurnInput: options.guestTurnInput ?? options.prompt },
    }, { onTextDelta: (delta) => { finalText += delta; options.onText?.(finalText); } });
    options.onCompletion?.({
      at: new Date().toISOString(), iteration: turn + 1,
      requestedModel: activeModel ?? null,
      resolvedModel: result.resolvedModel ?? null,
      resolvedVendor: result.resolvedVendor ?? null,
      account: result.account ?? null,
      routingMode: options.routingMode ?? 'auto',
      toolsAdvertised: availableActions.length,
      toolCalls: result.toolCalls.map((call) => call.name),
      finishReason: result.finishReason,
    });
    if (result.toolCalls.length && result.resolvedModel && !toolCallingModels.includes(result.resolvedModel)) {
      toolCallingModels.push(result.resolvedModel);
    }
    // A bounded tool loop is one logical agent turn. Keep its continuations on
    // the model that began it instead of asking Auto to reroute every tool result
    // independently (which previously moved research from MiniMax to Gemini just
    // before the required Canvas write). This is a preference, not a strict pin:
    // the gateway may still substitute when the provider becomes unavailable.
    if (!activeModel && result.resolvedModel) {
      activeModel = result.resolvedModel;
      activeModelStrict = false;
    }
    if (!result.toolCalls.length) {
      // An INTERRUPTED turn is not a turn the model chose to end. Truncation at the
      // output ceiling drops the tool call it was mid-way through emitting (its JSON
      // never closes), and an unparseable call is discarded by the provider — both
      // arrive here looking exactly like "the model declined to act", and both used
      // to be answered with "you repeated yourself, answer again", which reproduces
      // the same failure. Handled FIRST, with the directive that matches the actual
      // interruption: author smaller, or re-encode the call.
      const interruption = turnInterruption(result.finishReason);
      if (interruption && interruptedTurnRecoveries < MAX_INTERRUPTED_TURN_RECOVERIES) {
        interruptedTurnRecoveries += 1;
        options.onTrace?.({
          ts: new Date().toISOString(), category: 'error',
          label: interruption === 'truncated' ? 'response truncated' : 'malformed tool call',
          isError: true,
          result: { finishReason: result.finishReason, model: result.resolvedModel ?? null, attempt: interruptedTurnRecoveries },
        });
        messages.push({
          role: 'system',
          content: interruption === 'truncated' ? TRUNCATED_TURN_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE,
        });
        finalText = '';
        continue;
      }
      if (interruption && switchToProvenModel(
        result.resolvedModel,
        interruption === 'truncated'
          ? 'The prior model kept running past the output limit without finishing and has been disabled for this session. Author the requested artifact in small steps.'
          : 'The prior model kept emitting tool calls the provider could not parse and has been disabled for this session.',
      )) {
        finalText = '';
        continue;
      }
      // A DEGENERATE turn — the model returned nothing at all, or reproduced an
      // earlier assistant message instead of answering. Neither is an answer, and
      // neither is caught by the intent-based recoveries below (a plain question
      // degenerates just as easily as a command). Checked FIRST because an echoed
      // reply otherwise reaches the user as a fresh one and is stored, which is what
      // let a single failed turn become the template for every turn after it.
      const spoken = stripSpeakerLabel(result.text || finalText, speakerLabels).trim();
      if (!spoken || echoesEarlierAnswer(spoken, options.conversation, speakerLabels)) {
        if (!degenerateAnswerRecoveryUsed) {
          degenerateAnswerRecoveryUsed = true;
          messages.push({
            role: 'system',
            content: 'Your prior response was empty or repeated an earlier message in this conversation, so it did not answer anything. Do not restate a previous reply, and do not prefix your answer with a speaker name. Answer the user\'s latest message directly now, and call the canvas_* tools for any change it asks for.',
          });
          finalText = '';
          continue;
        }
        if (switchToProvenModel(result.resolvedModel, 'The prior model returned an empty or repeated response twice and has been disabled for this session.')) {
          finalText = '';
          continue;
        }
        finalText = '';
        break;
      }
      lastSpokenAnswer = spoken;
      // ESCALATION LADDER for a model that discussed an imperative canvas request
      // instead of executing it. Each rung is tried only when the one before it is
      // spent, hardest-available remedy first:
      //   1. re-state the command;
      //   2. hand the turn to a model that already emitted valid tool calls;
      //   3. no such model exists — re-state once more, now with research and board
      //      re-reads withdrawn, and say why prose is not an artifact;
      //   4. stop, and deliver what the model actually said (see the tail of this
      //      function) instead of a dead-end notice.
      // Rung 3 is what the measured 2026-08-14 failure needed and never got: the only
      // tool-calling model in that turn WAS the stalled one, so rung 2 was a no-op and
      // the loop went straight from rung 1 to giving up, four turns early.
      if (!options.participant && !proposedCanvasMutation && mutationRequested
        && (byName.has('canvas_add_object') || byName.has('canvas_update_object'))) {
        if (mutationRecoveries === 0 || (
          !switchToProvenModel(
            result.resolvedModel,
            'The prior model did not execute the Canvas command after a retry and has been disabled for this session. Stop researching and use canvas_add_object or canvas_update_object now to complete the user\'s requested artifact.',
          ) && mutationRecoveries < MAX_MUTATION_RECOVERIES
        )) {
          mutationRecoveries += 1;
          messages.push({ role: 'assistant', content: result.text || finalText });
          messages.push({
            role: 'system',
            // The later attempt runs with research and board re-reads already withdrawn,
            // so repeating "act now" adds nothing. What the first directive never
            // supplies is the reason a model stalls here: it has written the answer in
            // prose and has no idea the prose is not the artifact. Say that, and name
            // the one call left to it.
            content: mutationRecoveries > 1
              ? 'You have now answered twice in prose without creating anything. Prose in a reply is NOT a canvas artifact and the user cannot keep, edit or export it — only a canvas_add_object call puts it on their board. Make that call now, passing the full text you just wrote as the new object\'s authored content, and write nothing else in this response.'
              : 'Your prior response described or discussed an imperative Canvas request without executing it. Act now with the available canvas_add_object or canvas_update_object tool. If a non-Chat object is selected, update that exact object unless the user explicitly requested another one. For a Website/WYSIWYG change, send the complete authored fields.pages structure and websiteTheme; do not ask another optional question and do not rely on renderer defaults.',
          });
          finalText = '';
          continue;
        }
        // Either the turn moved to a proven model (which reset the ladder) or every
        // rung is spent. Continue in the first case, stop in the second.
        finalText = '';
        if (mutationRecoveries === 0) continue;
        break;
      }
      if (!options.participant && !proposedCanvasMutation && !executiveRequestRecoveryUsed
        && isExecutiveTeammateRequest(options.prompt) && byName.has('canvas_add_object')) {
        executiveRequestRecoveryUsed = true;
        messages.push({ role: 'assistant', content: result.text || finalText });
        messages.push({
          role: 'system',
          content: 'Your prior response did not execute the requested teammate action. Act now: add the named executive Agent, add the fully authored requested deliverable, and connect them with the available Canvas tools. A new canvas is sufficient context; put assumptions and open questions in the deliverable instead of asking a follow-up question.',
        });
        finalText = '';
        continue;
      }
      if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
        return finish(incompleteDocumentAnswer(notices, requestedPages, documentWords, documentWordCountExact));
      }
      // `spoken` is the answer with any copied speaker label already removed, so a
      // model that relapses cannot seed the next turn with a prefix to extend.
      return finish(verified(spoken));
    }
    messages.push({
      role: 'assistant', content: result.text,
      tool_calls: result.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })),
    });
    for (const call of result.toolCalls) {
      const toolStartedAt = Date.now();
      const action = byName.get(call.name);
      let args: unknown = {};
      try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }
      const words = call.name === 'canvas_add_object' ? authoredDocumentWords(args) : null;
      if (words != null) {
        documentWords = Math.max(documentWords ?? 0, words);
        documentWordCountExact = true;
      }
      let outcome: unknown;
      if (authoringOnly && NON_AUTHORING_TOOL_NAMES.has(call.name)) {
        outcome = { error: 'The bounded research phase has ended. Create the requested Canvas artifacts from the evidence already gathered and the board snapshot you already have.' };
      } else if (call.name === 'builtin_web_search' && narrowSearches >= MAX_NARROW_SEARCHES) {
        outcome = { error: 'Search stopped after two encyclopedic results. Fetch a known official URL directly or create the requested Canvas artifacts with the evidence already gathered.' };
      } else if (!action) {
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
      if (call.name === 'builtin_web_search' && isNarrowSearchResult(outcome)) narrowSearches += 1;
      if (outcome && typeof outcome === 'object') {
        const result = outcome as { proposed?: unknown; error?: unknown };
        if (result.proposed === true) proposedCanvasMutation = true;
        if (typeof result.error === 'string' && result.error.trim()
          && !(NON_AUTHORING_TOOL_NAMES.has(call.name) && (authoringOnly || narrowSearches >= MAX_NARROW_SEARCHES))) {
          lastToolError = result.error.trim();
        }
      }
      options.onTrace?.({ ts: new Date().toISOString(), category: outcome && typeof outcome === 'object' && 'error' in outcome ? 'error' : 'tool', label: call.name, durationMs: Math.max(0, Date.now() - toolStartedAt), args, result: outcome, isError: !!(outcome && typeof outcome === 'object' && 'error' in outcome) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) });
    }
    finalText = '';
  }
  if (requestedPages != null && documentWords != null && documentWords < requestedPages * WORDS_PER_DRAFT_PAGE) {
    return finish(incompleteDocumentAnswer(notices, requestedPages, documentWords, documentWordCountExact));
  }
  const trailing = stripSpeakerLabel(finalText, speakerLabels).trim();
  if (trailing && !echoesEarlierAnswer(trailing, options.conversation, speakerLabels)) return finish(verified(trailing));
  if (proposedCanvasMutation) return finish(notices.addedToCanvas);
  // From here down the string is a RUNTIME NOTICE, not something the model said. The
  // caller is told so it can record it as a failed turn instead of writing it into the
  // transcript as an assistant reply for the next turn to copy.
  // A tool that FAILED still outranks prose: the error names what blocked the turn and
  // what would clear it, which the model's own narration routinely gets wrong.
  if (lastToolError) {
    options.onUnanswered?.({ reason: 'tool-error', detail: lastToolError });
    return notices.toolError(lastToolError);
  }
  // Otherwise: an answer the model gave earlier in this turn is NOT a runtime notice, and
  // the fact that it never reached canvas_add_object does not make it worthless — for a
  // drafting request it IS the deliverable. Deliver it (still subject to the
  // unverified-creation check, which replaces an answer CLAIMING a canvas change nobody
  // made) rather than discarding the user's result in favour of a dead end.
  if (lastSpokenAnswer) {
    const checked = verified(lastSpokenAnswer);
    return finish(checked === lastSpokenAnswer ? notices.answeredWithoutCanvasChange(checked) : checked);
  }
  options.onUnanswered?.({ reason: mutationRequested ? 'command-not-executed' : 'no-answer' });
  return notices.noAnswer;
}
