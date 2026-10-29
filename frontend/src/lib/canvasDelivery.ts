import { transportRetryTrace } from '@seanhogg/builderforce-brain-embedded';
import type { DeliveryLedger, DeliveryTurn, LadderRung } from '@builderforce/agent-run';
import { echoesEarlierAnswer, stripSpeakerLabel } from '@/lib/canvasTranscript';
import { isExecutiveTeammateRequest } from '@/lib/canvasTurnOutcome';
import {
  AUTHORING_PHASE_DIRECTIVE,
  BUILD_HANDOFF_DIRECTIVE,
  BUILD_NOT_AUTHORED_DIRECTIVE,
  DEGENERATE_ANSWER_DIRECTIVE,
  DEGENERATE_HANDOFF_DIRECTIVE,
  EXECUTIVE_ACT_NOW_DIRECTIVE,
  MALFORMED_HANDOFF_DIRECTIVE,
  MALFORMED_TOOL_CALL_DIRECTIVE,
  MAX_INTERRUPTED_TURN_RECOVERIES,
  MAX_MUTATION_RECOVERIES,
  MUTATION_ACT_NOW_DIRECTIVE,
  MUTATION_HANDOFF_DIRECTIVE,
  MUTATION_PROSE_IS_NOT_ARTIFACT_DIRECTIVE,
  PROVIDER_HANDOFF_DIRECTIVE,
  PROVIDER_REROUTE_DIRECTIVE,
  TRUNCATED_HANDOFF_DIRECTIVE,
  TRUNCATED_TURN_DIRECTIVE,
} from '@/lib/canvasAiTurnBudget';
import { documentShortfallAnswer } from '@/lib/canvasAiTurnTail';
import { MUTATION_RUNG } from '@/lib/canvasPlatformTools';
import type { CanvasRun } from '@/lib/canvasAiRun';

/** The hand-off sentence: why the model was replaced, then who continues and why them. */
const continueOn = (directive: string) => (to: string): string =>
  `${directive} Continue on ${to}, which already emitted valid tool calls in this turn.`;

/**
 * What a canvas turn still OWES when the model stops calling tools, as the rungs the one
 * agent's stall ladder walks (`@builderforce/agent-run`, `policy/stall/ladder.ts`).
 *
 * A round-trip that ended without a tool call is not accepted as the answer until each
 * rung has had its say: an interrupted turn (truncated, or a call the provider could not
 * parse), a degenerate answer (empty, or an echo of an earlier reply), a build that never
 * wrote its app, a canvas command answered in prose, an executive-teammate request left
 * undone, a document short of its requested length. The agent owns the MECHANICS — re-state,
 * hand the turn to a model that already acted, re-state harder, then give up the way the
 * rung says; this supplies which rungs hold, and the words each one says. Pure over the
 * turn's facts ({@link CanvasRun}); nothing here iterates.
 */
export function canvasDeliveryLedger(run: CanvasRun): DeliveryLedger {
  const { options, notices, byName, mutationRequested, speakerLabels, requestedPages } = run;
  /** What the model said, with a copied speaker label removed. */
  const spokenOf = (content: string): string => stripSpeakerLabel(content || run.finalText, speakerLabels).trim();

  return {
    rungs: (turn: DeliveryTurn): readonly LadderRung[] => {
      const spoken = spokenOf(turn.content);
      const interruption = turn.interruption;
      // Truncation widens the output ceiling for the rest of the turn, whether or not a
      // re-statement is left to spend on it.
      if (interruption === 'truncated') run.truncatedOnce = true;
      const truncated = interruption === 'truncated';
      const shortfall = documentShortfallAnswer(notices, requestedPages, run.documentWords, run.documentWordCountExact);
      const canvasTools = byName.has('canvas_add_object') || byName.has('canvas_update_object');
      const authored = !options.participant;

      return [
        // An INTERRUPTED turn is not a turn the model chose to end. Truncation drops the tool
        // call it was mid-way through emitting (its JSON never closes), and an unparseable
        // call is discarded by the provider — both look like "the model declined to act", and
        // both used to be answered with "you repeated yourself", which reproduces the failure.
        // Handled FIRST, with the directive that matches the interruption.
        {
          id: 'canvas.interrupted',
          applies: !!interruption,
          restate: Array<string>(MAX_INTERRUPTED_TURN_RECOVERIES).fill(truncated ? TRUNCATED_TURN_DIRECTIVE : MALFORMED_TOOL_CALL_DIRECTIVE),
          free: MAX_INTERRUPTED_TURN_RECOVERIES,
          handoff: continueOn(truncated ? TRUNCATED_HANDOFF_DIRECTIVE : MALFORMED_HANDOFF_DIRECTIVE),
          spent: 'fall',
          onRestate: (attempt) => options.onTrace?.({
            ts: new Date().toISOString(), category: 'error',
            label: truncated ? 'response truncated' : 'malformed tool call',
            isError: true,
            result: { finishReason: run.lastFinishReason, model: turn.model ?? null, attempt },
          }),
        },
        // A DEGENERATE turn — nothing at all, or an earlier assistant message reproduced.
        // Neither is an answer, and neither is caught by the intent-based rungs below.
        // Checked early because an echoed reply otherwise reaches the user as a fresh one
        // and is stored, which let one failed turn become the template for every turn after.
        {
          id: 'canvas.degenerate',
          applies: !spoken || echoesEarlierAnswer(spoken, options.conversation, speakerLabels),
          restate: [DEGENERATE_ANSWER_DIRECTIVE],
          handoff: continueOn(DEGENERATE_HANDOFF_DIRECTIVE),
          spent: 'fail',
        },
        // Past the degenerate check: this is a real thing the model said, kept for the tail
        // even if a rung below sends the turn back and drops the reply it answers.
        { id: 'canvas.spoken', applies: false, restate: [], spent: 'fall', reached: () => { run.lastSpokenAnswer = spoken; } },
        // A build turn that PROVISIONED a workspace and is ending without writing a file of
        // the app. `canvasChanged` is true, so the act-now rung below never fires, and the
        // model's "I've created the project — you can now start adding files" reached the user
        // above a "Hello World!" preview. When every rung is spent, say what the board holds.
        {
          id: 'canvas.build',
          applies: authored && run.buildTurn && !run.buildAuthored,
          restate: [BUILD_NOT_AUTHORED_DIRECTIVE, BUILD_NOT_AUTHORED_DIRECTIVE],
          handoff: continueOn(BUILD_HANDOFF_DIRECTIVE),
          quote: true,
          spent: { settle: notices.buildNotAuthored },
        },
        // ESCALATION LADDER for a model that discussed an imperative canvas request instead
        // of executing it: re-state the command; hand the turn to a model that already emitted
        // valid tool calls; re-state once more, now with research and board re-reads withdrawn
        // and the reason prose is not an artifact; stop, and deliver what the model said.
        {
          id: MUTATION_RUNG,
          applies: authored && !run.canvasChanged && mutationRequested && canvasTools,
          restate: Array.from({ length: MAX_MUTATION_RECOVERIES }, (_, index) => (index === 0 ? MUTATION_ACT_NOW_DIRECTIVE : MUTATION_PROSE_IS_NOT_ARTIFACT_DIRECTIVE)),
          handoff: continueOn(MUTATION_HANDOFF_DIRECTIVE),
          quote: true,
          once: AUTHORING_PHASE_DIRECTIVE,
          spent: 'fail',
        },
        {
          id: 'canvas.executive',
          applies: authored && !run.canvasChanged && isExecutiveTeammateRequest(options.prompt) && byName.has('canvas_add_object'),
          restate: [EXECUTIVE_ACT_NOW_DIRECTIVE],
          quote: true,
          spent: 'fall',
        },
        { id: 'canvas.shortfall', applies: shortfall !== null, restate: [], spent: { settle: shortfall ?? '' } },
      ];
    },
    // `spoken` has any copied speaker label already removed, so a model that relapses cannot
    // seed the next turn with a prefix to extend.
    accept: (content) => run.verified(spokenOf(content)),
    // The executive request is offered once per turn, whichever model answers it.
    sticky: ['canvas.executive'],
    // The rungs ARE the canvas's stall judgement (not the narration heuristics), the canvas
    // shapes its own accepted answer, and it composes its closing answer from the board.
    owns: { narration: true, settle: true, synthesis: true },
    handedOff: (from, to) => {
      if (from) options.onModelDisabled?.(from);
      options.onModelFallback?.(to);
    },
    providerFailure: {
      handoff: continueOn(PROVIDER_HANDOFF_DIRECTIVE),
      reroute: PROVIDER_REROUTE_DIRECTIVE,
      rerouted: ({ message, step, outcome }) => options.onTrace?.(transportRetryTrace(new Date().toISOString(), step, outcome, message)),
      abandoned: () => { run.abandonedMidTurn = true; },
    },
  };
}
