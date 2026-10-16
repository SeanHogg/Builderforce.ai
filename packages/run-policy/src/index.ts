/**
 * `@builderforce/run-policy` — THE model hand-off policy for one agent run.
 *
 * Which role each turn asks for, which model and how strictly, which models are routed
 * around, when a spent model fails over and when a pin or lock is released — one pure
 * reducer every agent loop drives, so the same events produce the same choice on every
 * host. The plan→code re-ask's wire test and brief ride along, because every host that
 * plans before it codes makes that re-ask. Pure and I/O-free.
 */

export {
  DECLINE_STATUS,
  PIN_RELEASE_STATUSES,
  initialRunPolicy,
  nextTurn,
  offersHandOff,
  reduceRunPolicy,
  type RunPhase,
  type RunPolicyEvent,
  type RunPolicyOptions,
  type RunPolicyOutcome,
  type RunPolicyState,
  type TransportFailureKind,
  type TurnRequest,
} from './policy.js';
export { coderHandoffBrief, isCoderReask, type HandoffCall } from './coderHandoff.js';
export { resolveStallStep, type StallFailoverSource, type StallStep, type StallTurn } from './stallStep.js';
