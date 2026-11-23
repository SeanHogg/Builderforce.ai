/**
 * The tools a run advertises, resolved ONCE in its preamble (`runPreamble.ts`): the catalog the model is shown plus the conversational
 * `ask_user` / `hand_off` tools, and — once the system prompt and the per-turn block are known — which of them the prompt NAMES and
 * which must be advertised on every turn. Pure over the request and the run's prompt text.
 */

import { ASK_USER_TOOL, ASK_USER_TOOL_SPEC } from '@builderforce/agent-loop';
import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import type { BrainToolSpec } from '../streamChatCompletion';
import { HAND_OFF_TOOL_SPEC } from '../planHandoff';
import { localToolsIn, memoryToolsIn, studioToolsIn } from '../localWorkspaceTools';
import { skillToolsIn } from '../skillLibraryTools';
import { chatWorkObligationTools } from '../chatWorkLinking';
import { ticketToolVocabulary } from '../ticketToolVocabulary';
import type { PromptToolNames } from './brainRunContext';
import type { BrainRunRequest } from './runTypes';

/** What the host's catalog makes of a run: whether the run may ask, the tools the model is shown, and their names. */
export interface ResolvedCatalog {
  canAskUser: boolean;
  allTools: BrainToolSpec[] | undefined;
  catalogToolNames: string[];
}

export function resolveCatalog(req: BrainRunRequest): ResolvedCatalog {
  const { tools: toolSpecs, runTool } = req;
  // The catalog the model is shown, PLUS the conversational `ask_user` tool.
  //
  // `ask_user` is injected here rather than registered as a host action because it is
  // not an action: nothing executes it. It is a way for the run to END — the loop
  // intercepts the call as terminal and replies with the question (see
  // `beforeToolCalls`). Injected only where a tool call can be made at all, because on
  // a surface with no tool runner an advertised tool is a trap: the model's call would
  // be discarded and the question lost.
  //
  // Before this, only the server-side reply loop offered it, so a question asked in the
  // editor's chat could only ever arrive as prose — while that very surface rendered
  // `<QuestionCard>` / `<PendingQuestionBanner>` for a block nothing could produce.
  //
  // Gated on the host ALREADY having a catalog, not merely on having a runner. An
  // empty catalog is a FAULT SIGNAL — "zero tools advertised" is how a failed tenant
  // tool load is told apart from a model that simply declined to act — and injecting
  // one tool into it would report a broken catalog as a working one.
  const canAskUser = !!runTool && (toolSpecs?.length ?? 0) > 0;
  // `hand_off` rides the same gate: it is how PLANNING ends (see `planHandoff.ts`) — the
  // planner names the tasks, the run files them and hands them to the coding model(s).
  // Advertised only while the run is still planning; see `run/brainPlatformTools.ts`.
  const catalog = canAskUser ? [...(toolSpecs ?? []), ASK_USER_TOOL_SPEC, HAND_OFF_TOOL_SPEC] : toolSpecs;
  // The tools this host advertised for the run, by name. Resolved once: it answers both
  // "may this session change code itself" and "which local tools must never be
  // trimmed away" (the selection pin), and those two must see one catalog.
  const catalogToolNames = (req.tools ?? []).map((t) => t.function.name);
  return { canAskUser, allTools: catalog && catalog.length > 0 ? catalog : undefined, catalogToolNames };
}

/** The prompt text a run's tool names are read from. */
export interface PromptTexts {
  systemPrompt: string;
  /** The per-turn block (the volatile part), or nothing. */
  turnContext: string | null | undefined;
  /** The per-turn parts the lever folded into the system prompt (still THIS turn's text). */
  turnPartsInPrompt: readonly string[];
  userRequest: string;
  /** The Studio's preview-review contract text, when the run carries it. */
  previewReview: string | null;
}

/** What names the work-linking directive's obligations: the run's mode and server chat. */
export interface ObligationScope {
  runMode: string;
  serverChatId: number | null;
}

export function advertisedTools(
  prompt: PromptTexts,
  scope: ObligationScope,
  catalogToolNames: readonly string[],
  canAskUser: boolean,
): { promptTools: PromptToolNames; alwaysAdvertised: string[] } {
  const { systemPrompt, turnContext, turnPartsInPrompt, userRequest, previewReview } = prompt;
  // Tool names the resolved system prompt tells the model to call. Always advertised.
  //
  // This only catches `builtin_*` / `mcp__*` identifiers, which is the right pattern
  // for a catalog tool named in prose but blind to the LOCAL workspace tools —
  // `run_command`, `read_file`, `edit_file` and the rest carry no such prefix. The IDE
  // persona names every one of them ("use run_command for git … to commit, push, and
  // open a PR") and pinned none, so on the turn that asked for a commit `run_command`
  // scored zero against "commit the change and push to main", missed the 64-tool cut,
  // and the agent reported that the tool its own prompt had promised did not exist —
  // then burned 78 calls and 44 minutes looking for it.
  //
  // Those tools are not one domain among many that a query may be relevant to; they are
  // what this surface IS. Every one the host advertised is pinned, so relevance can
  // never decide whether the agent may touch the workspace it is sitting in. On a
  // surface without them (the web Brain) the intersection is empty and nothing changes.
  // The per-turn block is model-facing prose too: a tool it names is pinned exactly as
  // one named in the system prompt was when the block lived there.
  // Recorded by source, here where each text is known (`promptTools`): a capped editor turn requires what the turn and the Studio's
  // review contract name, while what only the standing system prompt names competes on relevance (`run/brainPlatformTools.ts`).
  const systemNamed = toolNamesMentionedIn(systemPrompt);
  const blockNamed = turnContext ? toolNamesMentionedIn(turnContext) : [];
  // The work-linking directive's OBLIGATIONS, as the directive declares them (`chatWorkObligationTools`): required on every
  // turn, the role cap's included, so a turn told to file a ticket can always see the tool (VS Code chat #157440).
  const obligation = scope.runMode === 'work'
    ? chatWorkObligationTools(scope.serverChatId, ticketToolVocabulary(catalogToolNames)).filter((n) => catalogToolNames.includes(n))
    : [];
  const promptTools: PromptToolNames = {
    system: systemNamed,
    turn: [...new Set([...blockNamed, ...toolNamesMentionedIn([...turnPartsInPrompt, userRequest].join('\n\n'))])],
    contract: previewReview ? toolNamesMentionedIn(previewReview) : [],
    ...(obligation.length > 0 ? { obligation } : {}),
  };
  const alwaysAdvertised = [
    ...new Set([...systemNamed, ...blockNamed, ...obligation]),
    ...localToolsIn(catalogToolNames),
    // The Studio's workspace vocabulary, including the preview review its contract
    // requires — empty everywhere but the Studio (see `studioToolsIn`).
    ...studioToolsIn(catalogToolNames),
    // The project-memory pair (recall before re-reading; remember what was learned) is
    // the cheapest tool in the catalog and the first one relevance would drop.
    ...memoryToolsIn(catalogToolNames),
    // The workspace's Agent Skills — its description IS the skill catalog, so dropping
    // it on relevance would hide every reviewed procedure the workspace has.
    ...skillToolsIn(catalogToolNames),
    // Asking the user is never off-topic: it is how the run stops when it cannot
    // proceed, so relevance against the request must not be what decides whether the
    // agent is allowed to ask. Its one schema is also the cheapest in the catalog.
    ...(canAskUser ? [ASK_USER_TOOL] : []),
  ];
  return { promptTools, alwaysAdvertised };
}
