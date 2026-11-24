import { R as RunFinding, a as BrainTraceEvent, B as BrainMessage, b as RunFindingsReport, c as RunView, d as RunFindingKind, e as RunFindingDetector } from './brainTriage-CGlDCUjo.cjs';
export { f as RunFindingEvidence, g as RunFindingEvidenceNote, h as RunFindingSeverity, i as RunFindingsFile, j as RunFindingsSummary, k as RunFindingsTurn, l as RunTurnKind } from './brainTriage-CGlDCUjo.cjs';
export { t as traceWithPersistedSteps } from './persistedSteps-BW6K1wir.cjs';

/**
 * `detectRunFindings` — a recorded run's report (PRD 46 §3.3): its summary, its turn strip, what went wrong (every
 * {@link RUN_FINDING_REGISTRY} detector over ONE {@link buildRunView}), and the files it touched. Findings are sorted
 * by severity, then by first evidence step — the same run always reports the same list in the same order. Pure.
 */

/** The id and title a host knows the run by; the title falls back to the run's first user turn. */
interface RunIdentity {
    id?: string;
    title?: string;
}
/** Severity first, then where the evidence starts, then kind — a total order. */
declare function compareFindings(a: RunFinding, b: RunFinding): number;
declare function detectRunFindings(events: BrainTraceEvent[], messages?: BrainMessage[], identity?: RunIdentity): RunFindingsReport;

/** Build the view of a recorded run. `events` is the merged trace (`traceWithPersistedSteps`). */
declare function buildRunView(events: readonly BrainTraceEvent[], messages?: readonly BrainMessage[]): RunView;

declare const RUN_FINDING_REGISTRY: ReadonlyArray<{
    kind: RunFindingKind;
    detect: RunFindingDetector;
}>;

declare const RUN_FINDING_POLICY: Readonly<{
    /** Read-only turns before the first write that make an analysis overrun. */
    analysisReadTurns: 8;
    /** Read-only turns after a readiness claim that leave it unkept. */
    unkeptReadTurns: 2;
    /** Turns that each made exactly one write, at which the run is writing serially. */
    serialSingleWriteTurns: 4;
    /** Prompt : completion ratio and prompt total at which the run's prompt is bloated. */
    promptBloatRatio: 50;
    promptBloatMinTokens: 500000;
    /** Writes of one path that make churn. */
    editChurnWrites: 4;
    /** Argument bytes of one non-write call that are oversized. */
    oversizedArgBytes: number;
    /** Identical text (bytes) two calls of one tool must share to count as a copied block. */
    sharedArgBytes: 1024;
    /** A turn this slow (ms) is slow. */
    slowTurnMs: 60000;
    /** Word-set overlap at which a pre-call text repeats the last kept one: memory's B7 fold threshold, so the
     *  diagnostic and the fold agree (`NARRATION_OVERLAP`, `@seanhogg/builderforce-memory/working`). */
    narrationOverlap: 0.8;
    /** Longest excerpt an evidence row quotes. */
    excerptChars: 160;
}>;

export { RUN_FINDING_POLICY, RUN_FINDING_REGISTRY, RunFinding, RunFindingKind, RunFindingsReport, type RunIdentity, RunView, buildRunView, compareFindings, detectRunFindings };
