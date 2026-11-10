/**
 * What the CODER reads next after a `hand_off` — the `next` of its result, one instruction per
 * way the plan was carried out (`planHandoff.ts` picks). Pure text.
 */

import { RESOLVE_OPEN_ISSUES, VERIFY_DELEGATION_STEP, VERIFY_STEP } from '@builderforce/agent-tools';

export const INLINE_NEXT =
  'HAND-OFF: the analysis is complete and you are the coding model. Implement the tasks below in order — do not re-plan or re-read what the planner already read. ' +
  `When all are done, check them. ${VERIFY_STEP} Then commit and push, and report per ticket.`;

/** What every fan-out leaves the coder: the children's open issues are its work now. */
const RESOLVE_REPORTS =
  `Each report ends with its Open issues — ${RESOLVE_OPEN_ISSUES}. Fix what the slices broke between them, and implement any task that failed.`;

// A host that fanned out can spawn, so the checking is always delegated from here.
export const PARALLEL_NEXT =
  'HAND-OFF: the tasks ran side by side, one coding agent each, and each has reported into the chat. ' +
  `You are the coding model. ${RESOLVE_REPORTS} Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;

export const BACKGROUND_NEXT =
  'HAND-OFF: one coding agent per task is now running IN THE BACKGROUND, each posting into the chat under its own name. ' +
  'You are the coding model: do not redo their tasks. Work on anything not delegated, then call wait_agents for their reports (or act on each as it arrives). ' +
  `${RESOLVE_REPORTS} Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;

// MIXED: the leading tasks were fanned out; the rest, later in the plan, are the coder's. They
// overlap the children's paths or own none, so a background run waits for the reports first.
export const MIXED_PARALLEL_NEXT =
  'HAND-OFF: some of the tasks ran side by side, one coding agent each, and each has reported into the chat. ' +
  `You are the coding model. ${RESOLVE_REPORTS} Then implement the remaining tasks below in plan order — they overlap those paths or own none, so they were not run beside them; do not re-plan or re-read what the planner already read. ` +
  `Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;

export const MIXED_BACKGROUND_NEXT =
  'HAND-OFF: some of the tasks are now running IN THE BACKGROUND, one coding agent each, posting into the chat under its own name. ' +
  'You are the coding model: do not redo their tasks. The remaining tasks below are yours and come after theirs in the plan; they overlap those paths or own none, so call wait_agents for their reports FIRST, then implement them in plan order — do not re-plan or re-read what the planner already read. ' +
  `${RESOLVE_REPORTS} Then check the combined change. ${VERIFY_DELEGATION_STEP} Then commit, push and report per ticket.`;
