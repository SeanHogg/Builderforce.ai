import { B as BrainTraceEvent, a as BrainMessage, aw as RoutingByRole, i as StaffingSummary } from './brainTriage-0eq1J6lS.cjs';
export { t as traceWithPersistedSteps } from './persistedSteps-CVRK8Ymk.cjs';

/**
 * Run findings (PRD 46 §3.1/§3.3): what a recorded agent run did wrong, named deterministically from its trace.
 *
 * The report types are structurally identical to the knowledge-graph-view port contract (`AgentRunReport` in
 * `packages/knowledge-graph-view/src/types.ts`): the view never imports brain-embedded, and the VS Code adapter is
 * where the two meet and the compiler proves they match. Keep the field names in step with that contract.
 */

type RunFindingSeverity = 'info' | 'warn' | 'error';
interface RunFindingsSummary {
    id: string;
    title: string;
    startedAt: string;
    endedAt: string;
    models: readonly string[];
    turns: number;
    counts: Readonly<Record<RunFindingSeverity, number>>;
}
type RunTurnKind = 'read' | 'write' | 'forced' | 'text' | 'failed';
interface RunFindingsTurn {
    index: number;
    role: string;
    model: string;
    kind: RunTurnKind;
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
}
/** A note a host renders in its own words on an evidence row (`agentRuns.evidenceNotes[note]`, holes = `params`). */
type RunFindingEvidenceNote = 'argBytes' | 'argBytesShared' | 'slowTurn';
interface RunFindingEvidence {
    step: number;
    turn?: number;
    label: string;
    path?: string;
    /** Text the run itself carried (a message, a title, an edit's new text) — never words of ours. */
    excerpt?: string;
    /** What this row measured, rendered by the host from its labels with {@link RunFindingEvidence.params}. */
    note?: RunFindingEvidenceNote;
    /** The note's numbers. */
    params?: Readonly<Record<string, number>>;
}
interface RunFinding {
    id: string;
    kind: RunFindingKind;
    severity: RunFindingSeverity;
    params: Readonly<Record<string, string | number>>;
    evidence: readonly RunFindingEvidence[];
}
interface RunFindingsFile {
    path: string;
    writes: number;
    checked: boolean;
}
interface RunFindingsReport {
    summary: RunFindingsSummary;
    turns: readonly RunFindingsTurn[];
    findings: readonly RunFinding[];
    files: readonly RunFindingsFile[];
}
/** Every kind a detector can name (PRD 46 §3.1). */
type RunFindingKind = 'analysis_overrun' | 'unkept_readiness' | 'serial_single_writes' | 'prompt_bloat' | 'unverified_writes' | 'bracket_break' | 'edit_churn' | 'filed_then_inline' | 'same_model_roles' | 'oversized_args' | 'slow_turns' | 'repeated_narration' | 'stopped_unverified';
/** One tool step of the run, read once. `step` is its 1-based position in the merged trace. */
interface ViewCall {
    step: number;
    /** The turn whose tool steps it followed; 0 for a step before the first turn. */
    turn: number;
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    /** Bytes of its arguments as recorded (JSON, UTF-8). */
    argBytes: number;
    /** A code change that ran and succeeded (not refused, failed or answered from the read cache). */
    write: boolean;
    /** A successful typecheck / test / diagnostics / lint call. */
    check: boolean;
    /** The workspace paths a write changed. */
    paths: readonly string[];
}
/** One model turn: an `llm.complete` and the tool steps that followed it. */
interface ViewTurn {
    index: number;
    step: number;
    role: string;
    model: string;
    kind: RunTurnKind;
    /** Structured calls the model emitted (the turn's own count). */
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    /** Bytes of tool-call arguments the turn emitted. */
    argBytes: number;
    /** The analysis budget forced this turn's hand-off (`loop.hand_off_due` before it). */
    forced: boolean;
    /** The turn's visible text (`agent.message`), empty when it wrote none. */
    text: string;
    /** The tool steps that followed it. */
    calls: readonly ViewCall[];
    /** The `via` of an explicit hand-off recorded on this turn (`llm.role_handoff`). */
    handOffVia?: string;
}
/** The run, read once from its merged trace; every detector reads this and nothing else. */
interface RunView {
    events: readonly BrainTraceEvent[];
    messages: readonly BrainMessage[];
    turns: readonly ViewTurn[];
    calls: readonly ViewCall[];
    /** The user's Stop, when it is the run's last act (no turn completed after it). */
    stopped: {
        step: number;
        model?: string;
    } | null;
    routing: RoutingByRole;
    staffing: StaffingSummary;
}
type RunFindingDetector = (view: RunView) => RunFinding[];

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

export { RUN_FINDING_POLICY, RUN_FINDING_REGISTRY, type RunFinding, type RunFindingEvidence, type RunFindingEvidenceNote, type RunFindingKind, type RunFindingSeverity, type RunFindingsFile, type RunFindingsReport, type RunFindingsSummary, type RunFindingsTurn, type RunIdentity, type RunTurnKind, type RunView, buildRunView, compareFindings, detectRunFindings };
