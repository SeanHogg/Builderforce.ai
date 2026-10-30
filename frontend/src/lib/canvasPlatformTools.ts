import type { ToolSchema } from '@builderforce/agent-tools';
import type { LadderProgress, PlatformTools, PlatformToolResult } from '@builderforce/agent-run';
import {
  NON_AUTHORING_TOOL_NAMES,
  authoredDocumentWords,
  isNarrowSearchResult,
  toolOutcomeChangedCanvas,
} from '@/lib/canvasTurnOutcome';
import { CANVAS_BUILD_FILE_WRITE_TOOLS, CANVAS_BUILD_TOOLS, CANVAS_BUILD_WORKSPACE_WRITE_TOOLS, workspacePathArg } from '@/lib/canvasBuildTools';
import {
  CANVAS_TOOL_LIMIT,
  CANVAS_TRUNCATED_RETRY_HINT,
  MALFORMED_TOOL_CALL_DIRECTIVE,
  MAX_NARROW_SEARCHES,
  TRUNCATED_ROUND_DIRECTIVE,
} from '@/lib/canvasAiTurnBudget';
import { executeCanvasTool, specsFor } from '@/lib/canvasAiToolExecution';
import { malformedCallLabel } from '@builderforce/agent-loop';
import type { CanvasRun } from '@/lib/canvasAiRun';

/** The delivery rung that arms the reserved authoring phase (`canvasDelivery.ts`). */
export const MUTATION_RUNG = 'canvas.mutation';

/**
 * The canvas's tools as a capability provider on the one agent's run: the board's
 * `canvas_*` tools, the tenant's MCP catalog and the guest research and career packs.
 *
 * This is the SURFACE: what it can run right now, and how one call is gated, run and
 * recorded on the board. Which of them the model is shown each turn is the agent's tools
 * policy (the same lexical selection the Brain uses), and the hand-off from analysis to
 * code is the model policy's — this only says which calls begin the work.
 */
export function canvasPlatformTools(run: CanvasRun): PlatformTools {
  const { options, byName, actions, mutationRequested, requiredTools, changedFiles } = run;
  const recent = (options.conversation ?? []).slice(-2).map((message) => message.content).join('\n');

  /**
   * The reserved authoring phase: armed once the model has IGNORED an explicit act-now
   * directive (the first re-statement is spent), it withdraws research and board re-reads
   * so the remaining turns go to the authoring tools. There is no step-count trigger —
   * the canvas runs without a step cap.
   */
  const authoringOnly = (progress: LadderProgress): boolean =>
    mutationRequested && !run.canvasChanged && (progress.rungs[MUTATION_RUNG] ?? 0) > 0;

  return {
    closed: true,
    // BrainToolSpec and ToolSchema are the same OpenAI function-tool schema; only the
    // declared type of `parameters` differs (an open record here, an object schema there).
    schemas: (progress) => specsFor(authoringOnly(progress) ? actions.filter((action) => !NON_AUTHORING_TOOL_NAMES.has(action.name)) : actions) as unknown as readonly ToolSchema[],
    // The query is the user's request plus the latest exchange, so a follow-up ("now add a
    // budget screen") still scores the tools its wording names.
    selection: { query: `${options.prompt}\n${recent}`, limit: CANVAS_TOOL_LIMIT, required: requiredTools },
    // Building the app is the hand-off from analysis to code: every later round-trip asks
    // the gateway for a coding model.
    handsOff: (name) => CANVAS_BUILD_TOOLS.has(name),
    malformed: {
      // `canvas_update_object` is how a long object gets the rest of itself — true here
      // and meaningless on any other surface.
      retryHint: CANVAS_TRUNCATED_RETRY_HINT,
      roundDirective: (truncated) => (truncated ? TRUNCATED_ROUND_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE),
      refused: (call, truncated, outcome) => {
        if (truncated) run.truncatedOnce = true;
        options.onTrace?.({
          ts: new Date().toISOString(), category: 'error', isError: true, durationMs: 0,
          label: malformedCallLabel(call.name, truncated),
          args: { arguments: call.arguments.slice(0, 200) }, result: outcome,
        });
      },
    },
    execute: async (name, args, env): Promise<PlatformToolResult> => {
      // A stopped run must not START another tool. One already in flight is left to
      // settle (its own transport owns the cancellation); nothing after it runs.
      run.throwIfStopped();
      const toolStartedAt = Date.now();
      const action = byName.get(name);
      if (!run.workspaceTurn && CANVAS_BUILD_TOOLS.has(name)) run.workspaceTurn = true;
      const words = name === 'canvas_add_object' ? authoredDocumentWords(args) : null;
      if (words != null) {
        run.documentWords = Math.max(run.documentWords ?? 0, words);
        run.documentWordCountExact = true;
      }
      const outcome = await executeCanvasTool(name, action, args, {
        authoringOnly: authoringOnly(env.progress),
        searchesExhausted: run.narrowSearches >= MAX_NARROW_SEARCHES,
        autoApprove: !!options.autoApprove,
        confirmAction: options.confirmAction,
      });
      if (name === 'builtin_web_search' && isNarrowSearchResult(outcome)) run.narrowSearches += 1;
      if (toolOutcomeChangedCanvas(outcome)) {
        run.canvasChanged = true;
        if (CANVAS_BUILD_WORKSPACE_WRITE_TOOLS.has(name)) run.buildTurn = true;
        if (CANVAS_BUILD_FILE_WRITE_TOOLS.has(name)) {
          run.buildAuthored = true;
          const path = workspacePathArg((args as { path?: unknown } | null)?.path);
          if (path) changedFiles.add(path);
        }
      }
      if (outcome && typeof outcome === 'object') {
        const result = outcome as { error?: unknown };
        if (typeof result.error === 'string' && result.error.trim()
          && !(NON_AUTHORING_TOOL_NAMES.has(name) && (authoringOnly(env.progress) || run.narrowSearches >= MAX_NARROW_SEARCHES))) {
          run.lastToolError = result.error.trim();
        }
      }
      const isError = !!(outcome && typeof outcome === 'object' && 'error' in outcome);
      options.onTrace?.({ ts: new Date().toISOString(), category: isError ? 'error' : 'tool', label: name, durationMs: Math.max(0, Date.now() - toolStartedAt), args, result: outcome, isError });
      return { data: outcome, isError };
    },
  };
}
