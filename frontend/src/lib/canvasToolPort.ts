import type { ChatCompletionMessage } from '@seanhogg/builderforce-brain-embedded';
import { malformedCallOutcome, malformedCallLabel, type LoopPorts } from '@builderforce/agent-loop';
import {
  NON_AUTHORING_TOOL_NAMES,
  authoredDocumentWords,
  isNarrowSearchResult,
  toolOutcomeChangedCanvas,
} from '@/lib/canvasTurnOutcome';
import { CANVAS_BUILD_FILE_WRITE_TOOLS, CANVAS_BUILD_TOOLS, CANVAS_BUILD_WORKSPACE_WRITE_TOOLS, workspacePathArg } from '@/lib/canvasBuildTools';
import { CANVAS_TRUNCATED_RETRY_HINT, MAX_CANVAS_BUILD_TURNS, MAX_NARROW_SEARCHES } from '@/lib/canvasAiTurnBudget';
import { executeCanvasTool } from '@/lib/canvasAiToolExecution';
import { reportToPolicy, type CanvasRun } from '@/lib/canvasAiRun';

/**
 * The canvas loop's TOOL port — runs one call: refuses one whose arguments never
 * parsed, widens the turn into a build the moment it touches an app, executes it
 * through the shared canvas executor, and records what it changed on the board.
 */
export function canvasToolPort(run: CanvasRun): LoopPorts<ChatCompletionMessage>['dispatch'] {
  const { options, byName, budget, toolsUsedThisTurn, changedFiles } = run;
  return async (call) => {
    const toolStartedAt = Date.now();
    const action = byName.get(call.name);
    const args: unknown = call.args;
    // A call whose arguments never parsed is NOT run. The kernel hands it over with
    // `args: {}` and `malformed: true` (its policy: never abort a run on bad JSON),
    // and running it anyway is how three `canvas_write_build_file` calls executed
    // with no path and failed "A path is required." — each one the tail of a
    // response that hit the output ceiling. The model is told which of the two
    // things happened, because the remedies are opposites: send less, or encode
    // correctly. Not recorded as a tool error — the tool never ran.
    if (call.malformed) {
      run.discardedCallThisRound = true;
      const truncated = run.lastTurnInterruption === 'truncated';
      if (truncated) run.truncatedOnce = true;
      const outcome = malformedCallOutcome(call, truncated, truncated ? CANVAS_TRUNCATED_RETRY_HINT : undefined)!;
      options.onTrace?.({
        ts: new Date().toISOString(), category: 'error', isError: true, durationMs: 0,
        label: malformedCallLabel(call.name, truncated),
        args: { arguments: call.raw.arguments.slice(0, 200) }, result: outcome,
      });
      return { data: outcome, isError: true };
    }
    toolsUsedThisTurn.add(call.name);
    if (!run.workspaceTurn && CANVAS_BUILD_TOOLS.has(call.name)) {
      // The turn is working in an app from here on (see CANVAS_BUILD_RESPONSE_TOKENS
      // and MAX_CANVAS_BUILD_TURNS). Widened once; never narrowed back. Building the
      // app is the hand-off from analysis to code: every later round-trip asks the
      // gateway for a coding model.
      run.workspaceTurn = true;
      reportToPolicy(run, { type: 'hand_off' });
      budget.stepCap = Math.max(budget.stepCap, MAX_CANVAS_BUILD_TURNS);
    }
    const words = call.name === 'canvas_add_object' ? authoredDocumentWords(args) : null;
    if (words != null) {
      run.documentWords = Math.max(run.documentWords ?? 0, words);
      run.documentWordCountExact = true;
    }
    const outcome = await executeCanvasTool(call.name, action, args, {
      authoringOnly: run.authoringOnly,
      searchesExhausted: run.narrowSearches >= MAX_NARROW_SEARCHES,
      autoApprove: !!options.autoApprove,
      confirmAction: options.confirmAction,
    });
    if (call.name === 'builtin_web_search' && isNarrowSearchResult(outcome)) run.narrowSearches += 1;
    if (toolOutcomeChangedCanvas(outcome)) {
      run.canvasChanged = true;
      if (CANVAS_BUILD_WORKSPACE_WRITE_TOOLS.has(call.name)) run.buildTurn = true;
      if (CANVAS_BUILD_FILE_WRITE_TOOLS.has(call.name)) {
        run.buildAuthored = true;
        const path = workspacePathArg((args as { path?: unknown } | null)?.path);
        if (path) changedFiles.add(path);
      }
    }
    if (outcome && typeof outcome === 'object') {
      const result = outcome as { error?: unknown };
      if (typeof result.error === 'string' && result.error.trim()
        && !(NON_AUTHORING_TOOL_NAMES.has(call.name) && (run.authoringOnly || run.narrowSearches >= MAX_NARROW_SEARCHES))) {
        run.lastToolError = result.error.trim();
      }
    }
    const isError = !!(outcome && typeof outcome === 'object' && 'error' in outcome);
    options.onTrace?.({ ts: new Date().toISOString(), category: isError ? 'error' : 'tool', label: call.name, durationMs: Math.max(0, Date.now() - toolStartedAt), args, result: outcome, isError });
    return { data: outcome, isError };
  };
}
