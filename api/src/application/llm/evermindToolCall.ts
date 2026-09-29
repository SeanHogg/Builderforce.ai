/**
 * The gateway's half of Evermind tool calling: its calibration knob and its decision
 * log. The planner itself — schema-driven constrained decoding, the margin it reports,
 * the OpenAI tool-call shape — is `@seanhogg/builderforce-memory/evermind`, shared with
 * every host that serves an Evermind head.
 */
import { resolveToolChoiceMinMargin } from '@seanhogg/builderforce-memory/evermind';

/**
 * The margin bar actually in force, honouring `EVERMIND_TOOL_CHOICE_MIN_MARGIN` — ONE
 * resolver for the serve-time gate and the Studio bench, so the bench can never report
 * a bar the gateway is not applying. An env knob so it can be calibrated from the
 * logged margins without a deploy per candidate value.
 */
export function evermindToolChoiceMinMargin(env?: { EVERMIND_TOOL_CHOICE_MIN_MARGIN?: string }): number {
  return resolveToolChoiceMinMargin(env?.EVERMIND_TOOL_CHOICE_MIN_MARGIN);
}

/**
 * Emit one structured line per tool decision, accepted or refused. Calibration needs
 * the DISTRIBUTION, so every decision is logged — logging only refusals would show
 * exactly the half of the data that cannot tell you whether the bar is too high.
 */
export function logToolChoiceMargin(fields: {
  margin: number;
  bar: number;
  tool: string | null;
  candidates: number;
  refused: boolean;
}): void {
  // Structured single line — greppable in Workers logs as `evermind.tool_choice`.
  console.log(JSON.stringify({
    event: 'evermind.tool_choice',
    margin: Number.isFinite(fields.margin) ? Number(fields.margin.toFixed(6)) : null,
    bar: fields.bar,
    tool: fields.tool,
    candidates: fields.candidates,
    refused: fields.refused,
  }));
}
