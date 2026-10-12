/**
 * DELEGATION REQUEST — the user asked for sub-agents, so the run starts them.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * VS Code chat #133: the user wrote "complete the remaining tickets using subagents".
 * The run held `spawn_agents` and `spawn_agent` (pinned, advertised every turn), named
 * them in its own reasoning, and then asked the user how to proceed instead:
 * "Execution is disabled in this workspace and there are no developer agents
 * available." Both reasons were false for a LOCAL child:
 *   - the execution kill-switch stops CLOUD runs; the `autoRun: execution_disabled`
 *     verdicts it had read on every ticket were about the cloud;
 *   - a child needs no Developer on the roster — `as_agent` is optional, and an
 *     anonymous child is a plain coding sub-agent.
 * The Work directive already said the first half. A directive a model can reason its
 * way around is how the run ended on a question, so — as with `selfReviewShip.ts` —
 * the contract is enforced in the loop as well as stated in the prompt.
 *
 * Two halves, one module, so they cannot disagree:
 *   - {@link leftDelegationUndone} — the gate: an explicit sub-agent request, a host
 *     that can spawn, and no spawn attempted in this run.
 *   - {@link undelegatedRequestNudge} — what the run is told instead of settling.
 *
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

import type { BrainTraceEvent } from './brainTriage';

/** The local delegation tools. Calling either — successfully or not — is an attempt. */
const SPAWN_TOOLS: ReadonlySet<string> = new Set(['spawn_agent', 'spawn_agents']);

/**
 * The user asked for the work to be done by sub-agents. Narrow on purpose: "sub-agent(s)",
 * "spawn …", or parallel/fan-out agents — never a bare mention of an agent, which in this
 * product usually means a cloud teammate.
 */
const ASKS_FOR_SUBAGENTS =
  /\bsub[- ]?agents?\b|\bspawn(?:_agents?|\s+(?:agents?|workers?|children))\b|\b(?:parallel|concurrent)\s+(?:agents?|workers?)\b|\bfan[- ]?out\b/i;

/** …unless the request says NOT to use them. */
const DECLINES_SUBAGENTS =
  /\b(?:no|without|don'?t\s+use|do\s+not\s+use|never\s+use|skip(?:\s+the)?)\s+(?:any\s+)?sub[- ]?agents?\b/i;

export function asksForSubagents(text: string | null | undefined): boolean {
  const t = text ?? '';
  return ASKS_FOR_SUBAGENTS.test(t) && !DECLINES_SUBAGENTS.test(t);
}

/** Can this run spawn local children at all? (The web Brain cannot.) */
export function canSpawnHere(toolNames: readonly string[]): boolean {
  return toolNames.some((n) => SPAWN_TOOLS.has(n));
}

/**
 * Did this run TRY to delegate locally? Success is not required: a child the role check
 * refused, or one that failed, is a result to report — re-prompting would only repeat it.
 */
export function attemptedDelegation(events: readonly BrainTraceEvent[]): boolean {
  return events.some((e) => e.category === 'tool' && SPAWN_TOOLS.has(e.label));
}

/** What the loop knows when the run is about to stop or ask. */
export interface DelegationRequestInput {
  /** Names of the tools this run's host advertised. */
  toolNames: readonly string[];
  /** The user's own request for this run — never a nudge the loop injected. */
  requestText: string | null | undefined;
  /** THIS run's trace events. */
  events: readonly BrainTraceEvent[];
}

/**
 * Is this run about to stop (or ask) without starting the sub-agents the user asked for?
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the host can spawn local children;
 *  - the user explicitly asked for sub-agents, and did not say not to;
 *  - nothing in this run called `spawn_agent` / `spawn_agents`.
 */
export function leftDelegationUndone(input: DelegationRequestInput): boolean {
  return canSpawnHere(input.toolNames) && asksForSubagents(input.requestText) && !attemptedDelegation(input.events);
}

/**
 * The re-prompt. Names the two false blockers the model reached for, and the call that
 * clears them — a model told only "use sub-agents" argues from the kill-switch again.
 */
export function undelegatedRequestNudge(toolNames: readonly string[]): string {
  const fanOut = toolNames.includes('spawn_agents');
  const call = fanOut
    ? 'Call spawn_agents NOW: one workstream per open ticket whose files do not overlap — ticket=<id>, a complete standalone task brief, role "code". Each child is a clone of you and makes its change itself. It takes up to 4 per call and returns at once — the children run in the background, so start the next batch right away if there are more. Use spawn_agent for a slice that must run alone.'
    : 'Call spawn_agent NOW, one slice at a time, with a complete standalone task brief and role "code". The child is a clone of you and makes its change itself.';
  return (
    'The user asked for this work to be done by SUB-AGENTS, and none has been started. Do not ask how to proceed — the user already said. ' +
    'A sub-agent here is a LOCAL child run on this machine: it needs no cloud dispatch, no ticket assignment and no Developer on the roster. ' +
    'The workspace execution kill-switch and every `autoRun: execution_disabled` verdict stop CLOUD runs only — they do not apply to it. ' +
    'as_agent is optional: with no fitting teammate, OMIT it — the spawn tools staff the role on this project themselves (a capable teammate, or a Developer hired into the workspace and project, with the ticket assigned) and the child runs AS that agent. ' +
    `${call} Keep working while they run; when their reports are in (they arrive on their own, or call wait_agents), verify their changes and report what each child delivered, per ticket.`
  );
}
