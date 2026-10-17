import { turnInterruption, type ChatCompletionMessage } from '@seanhogg/builderforce-brain-embedded';
import type { LoopHooks } from '@builderforce/agent-loop';
import { echoesEarlierAnswer, stripSpeakerLabel } from '@/lib/canvasTranscript';
import { isExecutiveTeammateRequest } from '@/lib/canvasTurnOutcome';
import {
  BUILD_NOT_AUTHORED_DIRECTIVE,
  MALFORMED_TOOL_CALL_DIRECTIVE,
  MAX_INTERRUPTED_TURN_RECOVERIES,
  MAX_MUTATION_RECOVERIES,
  TRUNCATED_TURN_DIRECTIVE,
} from '@/lib/canvasAiTurnBudget';
import { documentShortfallAnswer } from '@/lib/canvasAiTurnTail';
import type { CanvasRun } from '@/lib/canvasAiRun';
import { switchToProvenModel } from '@/lib/canvasProviderRecovery';
import type { CanvasTurn } from '@/lib/canvasModelPort';

/**
 * The canvas loop's `onNoToolCalls` hook — a round-trip that ended without a tool call
 * is not accepted as the answer until the ladders have had their say: an interrupted
 * turn (truncated, or a call the provider could not parse), a degenerate answer (empty,
 * or an echo of an earlier reply), a build that never wrote its app, a canvas command
 * answered in prose, an executive-teammate request left undone, a document short of its
 * requested length. Each rung re-states, hands the turn to a proven model, or stops.
 */
export function canvasNoToolCallsHook(run: CanvasRun): NonNullable<LoopHooks<ChatCompletionMessage>['onNoToolCalls']> {
  const { options, messages, notices, byName, mutationRequested, speakerLabels, requestedPages } = run;
  return async (_ctx, turn) => {
    const result = turn.meta as CanvasTurn;
    // An INTERRUPTED turn is not a turn the model chose to end. Truncation at the
    // output ceiling drops the tool call it was mid-way through emitting (its JSON
    // never closes), and an unparseable call is discarded by the provider — both
    // arrive here looking exactly like "the model declined to act", and both used
    // to be answered with "you repeated yourself, answer again", which reproduces
    // the same failure. Handled FIRST, with the directive that matches the actual
    // interruption: author smaller, or re-encode the call.
    const interruption = turnInterruption(result.finishReason);
    if (interruption === 'truncated') run.truncatedOnce = true;
    if (interruption && run.interruptedTurnRecoveries < MAX_INTERRUPTED_TURN_RECOVERIES) {
      run.interruptedTurnRecoveries += 1;
      options.onTrace?.({
        ts: new Date().toISOString(), category: 'error',
        label: interruption === 'truncated' ? 'response truncated' : 'malformed tool call',
        isError: true,
        result: { finishReason: result.finishReason, model: result.resolvedModel ?? null, attempt: run.interruptedTurnRecoveries },
      });
      messages.push({
        role: 'system',
        content: interruption === 'truncated' ? TRUNCATED_TURN_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE,
      });
      run.finalText = '';
      return { action: 'continue' };
    }
    if (interruption && switchToProvenModel(run,
      result.resolvedModel,
      interruption === 'truncated'
        ? 'The prior model kept running past the output limit without finishing and has been disabled for this session. Author the requested artifact in small steps.'
        : 'The prior model kept emitting tool calls the provider could not parse and has been disabled for this session.',
    )) {
      run.finalText = '';
      return { action: 'continue' };
    }
    // A DEGENERATE turn — the model returned nothing at all, or reproduced an
    // earlier assistant message instead of answering. Neither is an answer, and
    // neither is caught by the intent-based recoveries below (a plain question
    // degenerates just as easily as a command). Checked FIRST because an echoed
    // reply otherwise reaches the user as a fresh one and is stored, which is what
    // let a single failed turn become the template for every turn after it.
    const spoken = stripSpeakerLabel(result.text || run.finalText, speakerLabels).trim();
    if (!spoken || echoesEarlierAnswer(spoken, options.conversation, speakerLabels)) {
      if (!run.degenerateAnswerRecoveryUsed) {
        run.degenerateAnswerRecoveryUsed = true;
        messages.push({
          role: 'system',
          content: 'Your prior response was empty or repeated an earlier message in this conversation, so it did not answer anything. Do not restate a previous reply, and do not prefix your answer with a speaker name. Answer the user\'s latest message directly now, and call the canvas_* tools for any change it asks for.',
        });
        run.finalText = '';
        return { action: 'continue' };
      }
      if (switchToProvenModel(run, result.resolvedModel, 'The prior model returned an empty or repeated response twice and has been disabled for this session.')) {
        run.finalText = '';
        return { action: 'continue' };
      }
      run.finalText = '';
      return { action: 'stop', ok: false };
    }
    run.lastSpokenAnswer = spoken;
    // A build turn that PROVISIONED a workspace and is ending without writing a file of
    // the app. `canvasChanged` is true, so the act-now ladder below never fires, and the
    // model's "I've created the project — you can now start adding files" reached the
    // user above a "Hello World!" preview (session `local-148925cf`). Same rungs as that
    // ladder — re-state, hand to a proven model, re-state once more — and when every
    // rung is spent, say what the board actually holds instead of the model's claim.
    if (!options.participant && run.buildTurn && !run.buildAuthored) {
      if (run.buildAuthoringRecoveries === 0 || (
        !switchToProvenModel(run, result.resolvedModel, `The prior model provisioned the workspace and stopped without writing the app. ${BUILD_NOT_AUTHORED_DIRECTIVE}`)
        && run.buildAuthoringRecoveries < MAX_MUTATION_RECOVERIES
      )) {
        run.buildAuthoringRecoveries += 1;
        messages.push({ role: 'assistant', content: result.text || run.finalText });
        messages.push({ role: 'system', content: BUILD_NOT_AUTHORED_DIRECTIVE });
        run.finalText = '';
        return { action: 'continue' };
      }
      run.finalText = '';
      if (run.buildAuthoringRecoveries === 0) return { action: 'continue' };
      run.settled = await run.finish(notices.buildNotAuthored);
      return { action: 'stop', ok: true };
    }
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
    if (!options.participant && !run.canvasChanged && mutationRequested
      && (byName.has('canvas_add_object') || byName.has('canvas_update_object'))) {
      if (run.mutationRecoveries === 0 || (
        !switchToProvenModel(run,
          result.resolvedModel,
          'The prior model did not execute the Canvas command after a retry and has been disabled for this session. Stop researching and use canvas_add_object or canvas_update_object now to complete the user\'s requested artifact.',
        ) && run.mutationRecoveries < MAX_MUTATION_RECOVERIES
      )) {
        run.mutationRecoveries += 1;
        messages.push({ role: 'assistant', content: result.text || run.finalText });
        messages.push({
          role: 'system',
          // The later attempt runs with research and board re-reads already withdrawn,
          // so repeating "act now" adds nothing. What the first directive never
          // supplies is the reason a model stalls here: it has written the answer in
          // prose and has no idea the prose is not the artifact. Say that, and name
          // the one call left to it.
          content: run.mutationRecoveries > 1
            ? 'You have now answered twice in prose without creating anything. Prose in a reply is NOT a canvas artifact and the user cannot keep, edit or export it — only a canvas_add_object call puts it on their board. Make that call now, passing the full text you just wrote as the new object\'s authored content, and write nothing else in this response.'
            : 'Your prior response described or discussed an imperative Canvas request without executing it. Act now with the available canvas_add_object or canvas_update_object tool. If a non-Chat object is selected, update that exact object unless the user explicitly requested another one. For a Website/WYSIWYG change, send the complete authored fields.pages structure and websiteTheme; do not ask another optional question and do not rely on renderer defaults.',
        });
        run.finalText = '';
        return { action: 'continue' };
      }
      // Either the turn moved to a proven model (which reset the ladder) or every
      // rung is spent. Continue in the first case, stop in the second.
      run.finalText = '';
      if (run.mutationRecoveries === 0) return { action: 'continue' };
      return { action: 'stop', ok: false };
    }
    if (!options.participant && !run.canvasChanged && !run.executiveRequestRecoveryUsed
      && isExecutiveTeammateRequest(options.prompt) && byName.has('canvas_add_object')) {
      run.executiveRequestRecoveryUsed = true;
      messages.push({ role: 'assistant', content: result.text || run.finalText });
      messages.push({
        role: 'system',
        content: 'Your prior response did not execute the requested teammate action. Act now: add the named executive Agent, add the fully authored requested deliverable, and connect them with the available Canvas tools. A new canvas is sufficient context; put assumptions and open questions in the deliverable instead of asking a follow-up question.',
      });
      run.finalText = '';
      return { action: 'continue' };
    }
    const shortfall = documentShortfallAnswer(notices, requestedPages, run.documentWords, run.documentWordCountExact);
    if (shortfall !== null) {
      run.settled = await run.finish(shortfall);
      return { action: 'stop', ok: true };
    }
    // `spoken` is the answer with any copied speaker label already removed, so a
    // model that relapses cannot seed the next turn with a prefix to extend.
    run.settled = await run.finish(run.verified(spoken));
    return { action: 'stop', ok: true };
  };
}
