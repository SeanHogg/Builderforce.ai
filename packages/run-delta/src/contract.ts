/**
 * run-delta/contract.ts — THE run delta contract (PRD 41 §C4). Pure types, no I/O.
 *
 * Diff the facts, not the text: both sides of a run are reduced to findings and metrics by
 * deterministic rules, the delta is a set difference with lineage (memory `matchLineage`),
 * and every verdict traces to evidence. Hosts (VS Code, on-prem, cloud container) supply
 * {@link DeltaPorts}; this package never reads a file, a clock or the network.
 *
 * Rules are REGISTRY DATA (principle 5): a new check is one {@link DeltaRule} row in
 * `registry/`, never a branch in the engine. A dimension with no rule that could run reports
 * `not_measured` with a reason — a missing measurement is never shown as zero findings.
 */

import type { FindingIdentity } from '@seanhogg/builderforce-memory/knowledge';
import type { AnalyzerResult, AnalyzerRule, AnalyzerStatus } from './contract/analyzers.js';
import type { DeltaRegistries } from './contract/registries.js';

/** The L3 analyzer half of the contract lives in its own module; it is part of this one. */
export * from './contract/analyzers.js';

export type Verdict = 'better' | 'worse' | 'same' | 'not_comparable' | 'not_measured';
/**
 * `present` = shown as "present now" WITHOUT lineage (C9): the finding's kind is not comparable for
 * this delta, or its file's before side could not be resolved. It never counts toward a verdict.
 */
export type Lineage = 'introduced' | 'resolved' | 'changed' | 'persisting' | 'present';
export type Severity = 'info' | 'warn' | 'error';

/** `security`, `performance`, `quality`, or one ISO/IEC 25010 sub-dimension `ilities.<char>`. */
export type DimensionId =
    | 'security'
    | 'performance'
    | 'quality'
    | 'ilities.functional-suitability'
    | 'ilities.compatibility'
    | 'ilities.interaction-capability'
    | 'ilities.reliability'
    | 'ilities.maintainability'
    | 'ilities.flexibility'
    | 'ilities.safety';

/** Which fact kinds a rule reads (B1). `content` = the normalized bytes; cutoff never applies. */
export type FactKind = 'structure' | 'body' | 'content';

/** One piece of evidence. `path` is root-relative POSIX; lines are 1-based and informational (never in an identity). */
export interface Evidence {
    side: 'before' | 'after';
    path: string;
    line?: number;
    /** A short excerpt. Every string of a finding is redacted (`@builderforce/secret-redaction`) before it leaves the engine. */
    snippet?: string;
    /** e.g. a route key, a guard name, a metric id. */
    note?: string;
}

export interface DeltaFinding {
    identity: FindingIdentity;
    dimension: DimensionId;
    ruleId: string;
    ruleVersion: number;
    severity: Severity;
    lineage: Lineage;
    change?: 'grew' | 'shrank' | 'moved';
    /** `heuristic` renders with ≈ and never alone sets `worse` at error (C5 verdict rule). */
    confidence: 'measured' | 'heuristic';
    /** Stable reason/label params for the localized row (e.g. `{ route: 'POST /api/x', guard: 'requireAuth' }`). */
    params: Record<string, string | number>;
    evidence: Evidence[];
    waiver?: { by: string; reason: string; at: string };
}

export interface MetricDelta {
    metricId: string;
    /** null = not measured on that side. Quantized integers of `step` (B8.2). */
    before: number | null;
    after: number | null;
    /** Decimal step the integer values are expressed in (e.g. 0.01). */
    step: number;
    unit: string;
    betterWhen: 'lower' | 'higher';
    threshold: { warn: number; error: number; kind: 'abs' | 'pct' };
    /**
     * How a sampled metric's change was judged. `decision` is the D9.2 sequential test's (`sprt-sign` only): `reject`
     * (a decided change; it still needs its CI beyond ±warn) or `accept` (no change: within noise).
     */
    significance?: { method: 'wilcoxon-signed-rank' | 'sprt-sign' | 'none'; p?: number; ci?: [number, number]; decision?: 'reject' | 'accept' };
}

/**
 * What measured a dimension: a rule (`tool` = its id, `version` = its version) or an L3 analyzer (`tool` = the
 * analyzer, `version` = the tool's own version; `''` when it never started). `side` names the side a non-`ok`
 * analyzer entry is about (absent = both, or a rule). `pending`: an analyzer of a phase-1 delta (`ComputeOptions`) whose
 * run has not settled yet; the final delta replaces it.
 */
export interface MeasuredBy {
    tool: string;
    version: string;
    status: AnalyzerStatus | 'pending';
    reason?: string;
    side?: 'before' | 'after';
    /** Provenance: the dynamic-tier check that produced what this analyzer measured ({@link AnalyzerResult.producedBy}). */
    producedBy?: string;
}

export interface DimensionResult {
    id: DimensionId;
    verdict: Verdict;
    /** Reason codes (stable strings), localized at render: `static-only`, `rule-not-built`, `before-unresolved`, `heuristic`, … */
    reasons: string[];
    findings: DeltaFinding[];
    metrics: MetricDelta[];
    measuredBy: MeasuredBy[];
}

/** A file whose before side could not be resolved (C1), or that the delta excluded, and why. */
export interface UnresolvedFile {
    path: string;
    reason: 'preimage-too-large' | 'preimage-missing' | 'git-unavailable' | 'changed-ignored' | 'changed-outside-run' | 'submodule-moved' | 'binary';
}

export interface RunDelta {
    version: 1;
    runId: string;
    before: { manifestGeneration: string; merkleRoot: string; baseCommit?: string };
    after: { manifestGeneration: string; merkleRoot: string };
    impact: { changedFiles: string[]; renamed: Array<{ from: string; to: string }>; dependents: string[]; entryPoints: string[] };
    /**
     * Files the delta could not fully compare, with the reason. `changed-outside-run`, `binary`,
     * `changed-ignored` and `submodule-moved` files are outside the verdicts entirely. A file whose BEFORE
     * side is unresolved (`preimage-*`, `git-unavailable`) is still analyzed on its after side, and its
     * findings show with lineage `present`.
     */
    excluded: UnresolvedFile[];
    /** Sorted by dimension id. Every registered dimension is present, measured or not. */
    dimensions: DimensionResult[];
    /** Worst of dimensions by {@link HEADLINE_ORDER}. */
    headline: Verdict;
    /** The headline as a deterministic sentence MODEL (codes + counts); the UI renders it localized. */
    summary: HeadlineModel;
    /**
     * `score` is rounded to {@link BLAST_RADIUS_STEP}. `reasons` are codes (e.g. `insufficient-history`
     * when fewer than 5 past scores exist, so the band is `low` by default).
     */
    blastRadius: { score: number; band: 'low' | 'medium' | 'high'; formula: 'v1'; reasons: string[] };
    /**
     * Why finalization of an autonomous run is blocked (§12.5); empty = not blocked, and always empty for
     * interactive runs. Sorted codes, FAIL-CLOSED:
     *  - `<ruleId>`: a blocking rule has an introduced/changed ERROR finding;
     *  - `not-comparable:<ruleId>`: a blocking rule could not certify the run (its kind is not comparable,
     *    or it threw);
     *  - `head-switched`: HEAD moved to an unrelated branch, so no blocking rule ran.
     */
    blocking: string[];
    narrative?: { text: string; model: string; inputDigest: string };
    /**
     * The optional dynamic tier (C6.2, C8.4), one entry per check sorted by check: how it ended and WHO decided it ran
     * or not (D9.1 `scheduledBy`: policy, and a sampler's `p` and `seed`), so a stored delta replays the decision. In
     * the digest. Absent: the tier was not considered for this delta.
     */
    dynamic?: DynamicTierEntry[];
    /** sha256 of the canonical delta without `narrative` (B8.2: every number quantized). */
    digest: string;
}

/** One dynamic-tier check of a delta ({@link RunDelta.dynamic}). */
export interface DynamicTierEntry {
    check: string;
    status: 'ok' | 'failed' | 'skipped';
    reason?: string;
    tool: string;
    version: string;
    /** `dynamic/contract.ts` `DynamicScheduledBy`: who decided, and for a sampler (WS20) its model, `p`, `seed` and `wouldRun`. */
    scheduledBy: { policy: string; modelId?: string; modelVersion?: string; p?: number; seed?: number; wouldRun?: boolean };
}

// ─── The chat card (§C11.1) ──────────────────────────────────────────────────

/**
 * What an ignored `.builderforce/delta.json` entry is reported as. The engine's own drops ({@link OverrideResult}):
 * `unknown-key`, `invalid` (a section or one of its entries), `invalid-root` (not an object), `unsafe-regex`. The host's:
 * `invalid-json`, `unreadable` (its before side could not be read), and `truncated` (more were dropped than are kept).
 */
export const DROPPED_OVERRIDE_CODES = ['unknown-key', 'invalid', 'invalid-root', 'invalid-json', 'unsafe-regex', 'unreadable', 'truncated'] as const;
export type DroppedOverrideCode = (typeof DROPPED_OVERRIDE_CODES)[number];

/**
 * One ignored override, REDACTED: the code and the file section it sat in, never the repo's entry names or patterns.
 * `reason` is a fixed code: `unsafe-regex` → an {@link UnsafeReason}; `unreadable` → `preimage-missing` | `git-unavailable`.
 */
export interface DroppedOverride {
    code: DroppedOverrideCode;
    /** The top-level key of the file (`guards`, `io`, …); `''` when the whole file was dropped. */
    section: string;
    reason?: string;
    /** `truncated`: how many more were dropped. */
    count?: number;
}

/** The repository's `.builderforce/delta.json` overrides this delta ran without. */
export interface RunDeltaOverrides {
    dropped: DroppedOverride[];
}

/**
 * §12.5 hold reasons, as the run's execution record carries them (`hold.reason`): `run_delta_blocking:<rule ids>` when
 * its delta computed blocking codes, {@link RUN_DELTA_UNMEASURED} when an autonomous run that changed files could not be
 * measured (its delta failed or timed out: fail-closed). Both are released the same way.
 */
export const RUN_DELTA_HOLD_PREFIX = 'run_delta_blocking:';
export const RUN_DELTA_UNMEASURED = 'run_delta_unmeasured';

/**
 * Why `run-delta/release` was refused — the error code the host answers with, one per case the card says differently:
 * the run is not (or no longer) held, its hold is still being recorded, the release failed, the person is signed out (or
 * their identity could not be read), or the run is on a board and they lack its approver authority.
 */
export const RUN_DELTA_RELEASE_REFUSED = {
    notHeld: 'run_delta_release_refused:not_held',
    pending: 'run_delta_release_refused:pending',
    error: 'run_delta_release_refused:error',
    identityRequired: 'run_delta_release_identity_required',
    notApprover: 'run_delta_release_refused:not_approver',
} as const;
export type RunDeltaReleaseRefusal = keyof typeof RUN_DELTA_RELEASE_REFUSED;

/** A refusal's kind from the host's error text; anything unrecognised (a timeout, an older host) is `error`. */
export function releaseRefusalOf(message: string): RunDeltaReleaseRefusal {
    for (const [kind, code] of Object.entries(RUN_DELTA_RELEASE_REFUSED)) {
        if (message === code) return kind as RunDeltaReleaseRefusal;
    }
    return 'error';
}

/** `run-delta/open` refused: the path is not one the stored delta names, under its root. */
export const RUN_DELTA_OPEN_REFUSED = 'run_delta_open_refused';

/**
 * §12.5: the run is HELD at its finalize gate (awaiting review, not complete), as its execution record says — never the
 * delta record's own claim. `rules`: the blocking rule ids that held it (empty for an unmeasured hold); `unmeasured`: it
 * was held because its delta could not be measured.
 */
export interface RunDeltaHeld {
    rules: string[];
    unmeasured?: boolean;
}

/** The card fields every state carries. `at`: the transcript message the run produced (its last reply), the card's anchor. */
export interface RunDeltaCardBase {
    chatId: number;
    runId: string;
    at?: number;
    /** The run's hold (§12.5), read from its execution record. Absent: not held. */
    blocked?: RunDeltaHeld;
    /** A held run the person released ("Release run"): the hold no longer stands. */
    released?: boolean;
}

/** A computed delta for one repository. `status` absent = computed (records written before the field existed). */
export interface ComputedRunDeltaCard extends RunDeltaCardBase {
    status?: 'computed';
    /** The repository identity (its remote URL, else its root path). */
    repo: string;
    /** The absolute local repository root: a card path opens under it. */
    root: string;
    delta: RunDelta;
    overrides?: RunDeltaOverrides;
}

/**
 * A run whose delta is not (yet) there, one per run: `pending` while it computes, `failed` when the computation ended
 * (an error, or its budget ran out) without a delta for any repository. A computed card replaces it. A `failed` card of
 * an autonomous run carries `blocked.unmeasured` once its run is held for it.
 */
export interface RunDeltaProgressCard extends RunDeltaCardBase {
    status: 'pending' | 'failed';
    /** `pending` while the optional dynamic tier runs (C6.2/C8.4): its ceiling in whole minutes ("up to N min"). */
    dynamicMinutes?: number;
}

/** What `run-delta/card` carries and `run-delta/get` answers with. */
export type RunDeltaCardPayload = ComputedRunDeltaCard | RunDeltaProgressCard;

/** worse > not_comparable > better > same > not_measured. */
export const HEADLINE_ORDER: readonly Verdict[] = ['worse', 'not_comparable', 'better', 'same', 'not_measured'];

/** The decimal step the blast-radius score is quantized to (B8.2). */
export const BLAST_RADIUS_STEP = 0.001;

/**
 * One clause of the headline sentence, e.g. quality · worse · `tests-weakened` · 2. `code` is a stable
 * reason code (a rule id, `tests-weakened`, `findings-resolved`, a comparability reason); never English.
 */
export interface HeadlineClause {
    dimension: DimensionId;
    verdict: Verdict;
    code: string;
    count: number;
}

/** "Worse: security (1 route lost its auth guard) and quality (2 tests weakened). Performance unchanged." as data. */
export interface HeadlineModel {
    verdict: Verdict;
    /** Dimensions that are `worse`, `not_comparable` or `better`, ordered by {@link HEADLINE_ORDER} then id. */
    clauses: HeadlineClause[];
    /** Dimensions whose verdict is `same`, sorted. */
    unchanged: DimensionId[];
    /** Dimensions whose verdict is `not_measured`, sorted. */
    notMeasured: DimensionId[];
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** One file of the run's change set (the `changeset:<runId>:<repo>` record, `runChangeSets.ts`). */
export interface ChangedFileInput {
    path: string;
    /** EOL-normalized sha256 (memory `contentHash`) at baseline; absent = did not exist. */
    beforeHash?: string;
    /** At finalization; absent = deleted. */
    afterHash?: string;
    attribution: 'run-authored' | 'run-modified-existing' | 'outside-run';
    status: string;
}

export interface RunChangeSetInput {
    runId: string;
    /** Autonomous runs are subject to the blocking policy; interactive runs never block. */
    mode: 'interactive' | 'autonomous';
    baseCommit?: string;
    /** HEAD at finalization moved to an unrelated branch ⇒ the whole delta is `not_comparable` (`head-switched`). */
    headSwitched?: boolean;
    /**
     * What the run set out to do. `consolidation` runs must leave tests unchanged (C8.2), so
     * `assertion-edited-with-impl` is an error for them. Absent = `standard`.
     */
    kind?: RunKind;
    /**
     * C8.3: the files or areas the run's plan / ticket named (root-relative POSIX: an exact file, a folder
     * ending in `/`, or a `*` / `**` glob). Absent = the run had no plan with named files, so scope drift is
     * not measured (never "no drift").
     */
    plannedPaths?: readonly string[];
    files: ChangedFileInput[];
}

export type RunKind = 'standard' | 'consolidation';

/** A side's text of one file. `undefined` text = the file does not exist on that side. */
export interface SideText {
    path: string;
    hash?: string;
    text?: string;
}

/** Per-side facts the host already holds (memory `Extracted` + the built graph's findings). */
export interface SideFacts {
    manifestGeneration: string;
    merkleRoot: string;
    /** Findings of the whole tree on this side (memory generic + pack rules), each with its identity. */
    findings: Array<{ identity: FindingIdentity; kind: string; severity: Severity; nodes: string[]; params: Record<string, string | number> }>;
    /** Root-relative file → its resolved imports (root-relative), for the impact set and centrality. */
    imports: ReadonlyMap<string, readonly string[]>;
    /** Root-relative file → numeric badges (complexity, lines, routes count, …) from the extractors. */
    badges: ReadonlyMap<string, Readonly<Record<string, number | string>>>;
    /** Producer versions for comparability (memory `comparable`). */
    meta: import('@seanhogg/builderforce-memory/knowledge').ComparabilityMeta;
    /**
     * Root-relative file → its FileFacts v3 (PRD 41 §B3: exports with signature hashes, calls with awaited/inLoop,
     * entry points with guard chains, capability imports, test facts), from the host's fact extractor. Optional: a host
     * without facts omits it and rules fall back to text. A rule reads it through `support/fileFacts.ts`; facts of a
     * different `extractor` tag on the two sides are not comparable (C9: put the tag in `meta`).
     */
    fileFacts?: ReadonlyMap<string, import('@seanhogg/builderforce-memory/knowledge').FileFacts>;
}

/** What a host supplies. Every method is side-explicit; nothing here touches I/O itself. */
export interface DeltaPorts {
    /** Text of the given paths on one side (C1 resolution: extract cache / git / pre-images; after = working tree). */
    texts(side: 'before' | 'after', paths: readonly string[]): Promise<Map<string, SideText | UnresolvedFile>>;
    /**
     * Facts and findings of one side. `before` is the after graph with the run's IN-RUN changed files only
     * (attribution `run-authored` / `run-modified-existing`) swapped to their before extracts; files changed
     * outside the run keep their current facts on both sides, so they never read as a run's change.
     */
    facts(side: 'before' | 'after'): Promise<SideFacts>;
    /** 90-day churn per file (commits touching it); empty map when unknown (blast radius uses 0). */
    churn(paths: readonly string[]): Promise<Map<string, number>>;
    /** Past blast-radius scores of this repo, for the percentile bands (C10). */
    pastScores(): Promise<number[]>;
    /**
     * L3 (B7): one analyzer's result on one side — the after side on the working tree, the before side from the
     * host's cache (by content hash) or the materialized before tree. Asked once per side for every
     * {@link AnalyzerRule} (the after side only for `sides: 'after'`). Absent = the host has no analyzer tier:
     * no analyzer row is consulted and the static-tier rules of the same ids stand.
     */
    analyze?(side: 'before' | 'after', tool: string): Promise<AnalyzerResult>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * What a rule sees: both sides of the run's changed files, already resolved, EOL-normalized (LF) and
 * stripped of excluded files. Both maps are keyed by the file's LOGICAL path — its after-side path — so
 * a renamed file's before text sits under its new path (its `SideText.path` keeps the old one). Anchors
 * use the logical path; evidence uses `SideText.path`.
 */
export interface RuleInput {
    /** In-run files, sorted by path; a rename is one entry at its new path with status `renamed`. */
    changed: readonly ChangedFileInput[];
    before: ReadonlyMap<string, SideText>;
    after: ReadonlyMap<string, SideText>;
    beforeFacts: SideFacts;
    afterFacts: SideFacts;
    /** Repo overrides from `.builderforce/delta.json` merged over the built-in registries (BEFORE side; see {@link DimensionRegistry}). */
    registries: DeltaRegistries;
    /** {@link RunChangeSetInput.kind}, defaulted to `standard`. */
    runKind: RunKind;
    /** {@link RunChangeSetInput.plannedPaths}, normalized; absent = no plan (C8.3 not measured). */
    plannedPaths?: readonly string[];
    /** 90-day churn per changed file ({@link DeltaPorts.churn}, already fetched for the blast radius); empty = unknown. */
    churn: ReadonlyMap<string, number>;
}

/** A rule's raw output on ONE side, before lineage. */
export interface RuleFinding {
    identity: FindingIdentity;
    severity: Severity;
    confidence: 'measured' | 'heuristic';
    params: Record<string, string | number>;
    evidence: Evidence[];
}

export interface DeltaRule {
    id: string;
    version: number;
    dimension: DimensionId;
    reads: readonly FactKind[];
    /**
     * C9: the `ComparabilityMeta.tools` names (tools or upstream rules) whose version change, absence on
     * one side or failure makes this rule's kind `not_comparable`. Default `[id]`. Every other meta reason
     * (extractor, scope, repo, branch, truncation) gates only rules that read extracted facts (`structure`
     * / `body`) or are `global`: a `content` rule re-reads both sides' bytes itself, so only `head-switched`
     * stops it.
     */
    producers?: readonly string[];
    /**
     * C2: `impact` (default) rules read only the changed files. `global` rules read the whole tree
     * (`SideFacts.findings`); their `changed`/`persisting` findings are kept only when they touch the
     * impact set, while `introduced`/`resolved` are kept anywhere.
     */
    scope?: 'impact' | 'global';
    /**
     * Whether the rule can measure this run at all (e.g. `out-of-scope-change` needs the run's plan). False ⇒
     * the rule does not run, is listed in `measuredBy` as `skipped` with {@link DeltaRule.skipReason}, and does
     * not count as a measurement of its dimension. Absent = always applies.
     */
    applies?(input: RuleInput): boolean;
    /** The reason code recorded when {@link applies} is false (default `not-applicable`). */
    skipReason?: string;
    /** Findings of each side; lineage is computed by the engine, never by the rule. Pure. */
    derive(input: RuleInput): { before: RuleFinding[]; after: RuleFinding[] };
}

export interface MetricRule {
    id: string;
    version: number;
    dimension: DimensionId;
    /** As {@link DeltaRule.reads}: decides which comparability reasons gate the metric. */
    reads: readonly FactKind[];
    /** As {@link DeltaRule.producers}. Default `[id]`. */
    producers?: readonly string[];
    derive(input: RuleInput): MetricDelta[];
}

/** The data registries (C5–C8) live in `contract/registries.ts`; re-exported here so every import keeps working. */
export type { DeltaRegistries, StrideCategory } from './contract/registries.js';

/**
 * The registry a delta runs with. SECURITY: a host merging a repo's `.builderforce/delta.json`
 * (`withOverrides`) MUST read that file from the run's BEFORE side, never the working tree: a run must
 * not be able to weaken its own gate. A change to the file within the run is itself the blocking
 * `delta-config-changed` finding.
 */
export interface DimensionRegistry {
    dimensions: readonly DimensionId[];
    rules: readonly DeltaRule[];
    metrics: readonly MetricRule[];
    /** L3 analyzer rows (B7). Absent = none. */
    analyzers?: readonly AnalyzerRule[];
    registries: DeltaRegistries;
}
