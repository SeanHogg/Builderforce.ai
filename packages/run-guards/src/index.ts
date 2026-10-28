/**
 * `@builderforce/run-guards` — THE in-run loop-breakers every agent loop shares.
 *
 * The read guard (exact repeat, circling, covered window), the repeated-failure and
 * repeated-write tallies, edit-revert detection, the no-progress window, and the
 * progress detector that composes them into one steer → escalate → pause judgement
 * (cost PRD A3). The browser Brain binds the read guard to its own tool vocabulary; the
 * cloud loop persists the detector's JSON state between durable ticks. Pure.
 */

export { callFingerprint, contentHash, pathArgOf } from "./fingerprint.js";
export {
  REVISIT_HARD_AT,
  REVISIT_NUDGE_AT,
  VisitTally,
  revisitAdvisory,
  withAdvisory,
  type ReadVisit,
  type VisitTallyState,
} from "./visitTally.js";
export {
  ReadCoverage,
  canonicalReadArgs,
  type CachedRead,
  type CoveredRead,
  type ReadCoverageTraits,
} from "./readCoverage.js";
export { perFileResults, singleReadsOf } from "./multiRead.js";
export { parseShellFileRead, shellReadAsFileRead, type ShellFileRead, type ShellReadAsFileRead } from "./shellFileRead.js";
export {
  FAILURE_HARD_AT,
  FAILURE_NUDGE_AT,
  FailureTally,
  failureReason,
  repeatedFailureAdvisory,
  type FailureTallyState,
} from "./failureTally.js";
export { WriteLedger, contentWriteOf, repeatedWriteNote } from "./writeLedger.js";
export { EditRevertTracker, changesContent, type EditRevert, type EditRevertState } from "./editRevert.js";
export {
  NO_PROGRESS_TURNS,
  NoProgressTracker,
  isCheckCallDefault,
  isTestPath,
  type NoProgressPorts,
  type NoProgressState,
} from "./noProgress.js";
export {
  ProgressDetector,
  progressAdvice,
  progressPauseQuestion,
  progressSteerNote,
  type ObservedResult,
  type ProgressAction,
  type ProgressDetectorPorts,
  type ProgressDetectorState,
  type ProgressSignal,
  type ProgressSignalKind,
} from "./progressDetector.js";
// "Now I have everything I need", then another read (PRD 35 WS8p).
export { UNKEPT_READY_AT, UnkeptClaimTracker, claimsReady, type UnkeptClaimState } from "./readinessClaim.js";
export { BACK_TO_BACK_AT } from "./streak.js";
// "STOP executing" typed mid-run means the Stop button (PRD 35 E10).
export { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "./stopIntent.js";
export {
  READS_BEFORE_DELEGATION_NUDGE,
  ReadsWithoutSpawn,
  type DelegationCallKind,
  type ReadsWithoutSpawnState,
} from "./readsWithoutSpawn.js";
