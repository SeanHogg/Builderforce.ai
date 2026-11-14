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
export { isReadOnlyShellCall, isReadOnlyShellCommand } from "./readOnlyShell.js";
export { recordShellFileRead, shellPrintAsRead } from "./shellPrint.js";
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
  CHURN_TURNS,
  NO_PROGRESS_TURNS,
  REGROUND_TURNS,
  NoProgressTracker,
  isCheckCallDefault,
  isTestPath,
  type NoProgressPorts,
  type NoProgressState,
} from "./noProgress.js";
export {
  LADDER_RESET_TURNS,
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
// One trace row for every detector action — trips and the never-a-trip advisories.
export { progressTraceStep, type ProgressAdvisorySource, type ProgressTraceStep, type ProgressTripOverride } from "./progressTrace.js";
// "Now I have everything I need", then another read (PRD 35 WS8p).
export { UNKEPT_READY_AT, UnkeptClaimTracker, claimsReady, type UnkeptClaimState } from "./readinessClaim.js";
// B4: the one-off batching nudge after SERIAL_SINGLE_CALLS_AT single-readonly turns
// (PRD 45 §4.7) — advisory only, never a trip.
export {
  BATCHING_NUDGE_NOTE,
  BatchingNudge,
  SERIAL_SINGLE_CALLS_AT,
  type BatchingNudgeState,
} from "./batchingNudge.js";
// B1: the one-off advisory on the FIRST unkept claim (PRD 45 §4.7) — earlier than the ladder.
export {
  READINESS_ADVISORY_NOTE,
  ReadinessAdvisory,
  UNKEPT_STEER_AT,
  type ReadinessAdvisoryState,
} from "./readinessAdvisory.js";
export {
  DURABLE_IN_RUN_VERIFY_NOTE,
  IN_RUN_VERIFY_SCRIPT_NAMES,
  inRunVerifyOutcome,
  packageVerifyCommands,
  planInRunVerify,
  SANDBOX_IN_RUN_VERIFY_NOTE,
  type InRunVerifyCommandResult,
  type InRunVerifyOutcome,
  type InRunVerifyPlan,
  type InRunVerifySurface,
  type PackageScriptRunner,
  PUBLISH_TOOLS,
} from "./inRunVerify.js";
export { BACK_TO_BACK_AT } from "./streak.js";
// "STOP executing" typed mid-run means the Stop button (PRD 35 E10).
export { ABORT_TRIGGERS, isAbortTrigger, stopIntent } from "./stopIntent.js";
export {
  READS_BEFORE_DELEGATION_NUDGE,
  ReadsWithoutSpawn,
  type DelegationCallKind,
  type ReadsWithoutSpawnState,
} from "./readsWithoutSpawn.js";
// Deterministic ship gates (PRD 45 §4.2/§4.3): evidence keyed by bytes on disk.
export {
  MAX_CHECK_FINDINGS,
  createEvidenceLedger,
  normalizeEvidencePath,
  type CheckKind,
  type CheckRecord,
  type EvidenceLedger,
  type FileEvidence,
} from "./evidence/ledger.js";
export {
  DEFAULT_EVIDENCE_POLICY,
  fileIsUnchecked,
  outgoingGate,
  reviewGate,
  shellPublishHint,
  type EvidencePolicy,
  type GateVerdict,
  type NewSourceTestCoverage,
  type OutgoingFile,
  type ReviewVerdict,
} from "./evidence/gates.js";
export { gitCommandPattern } from "./evidence/gitCommandPattern.js";
