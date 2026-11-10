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

export type Verdict = 'better' | 'worse' | 'same' | 'not_comparable' | 'not_measured';
export type Lineage = 'introduced' | 'resolved' | 'changed' | 'persisting';
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
    /** A short excerpt, already redacted by the rule when it may hold a secret. */
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
    /**
     * C9: the finding's kind is `not_comparable` for this delta, so it is shown as "present now"
     * WITHOUT lineage (`lineage` is then `persisting` by convention and carries no meaning).
     */
    presentNow?: true;
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
    significance?: { method: 'wilcoxon-signed-rank' | 'sprt-sign' | 'none'; p?: number; ci?: [number, number] };
}

export interface MeasuredBy {
    tool: string;
    version: string;
    status: 'ok' | 'failed' | 'skipped';
    reason?: string;
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
    /** Files outside the verdicts, with the reason (changed outside this run, unresolved before side, …). */
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
    /** Rule ids whose introduced/changed findings block finalization of an autonomous run (§12.5 policy). Empty for interactive runs. */
    blocking: string[];
    narrative?: { text: string; model: string; inputDigest: string };
    /** sha256 of the canonical delta without `narrative` (B8.2: every number quantized). */
    digest: string;
}

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
    files: ChangedFileInput[];
}

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
}

/** What a host supplies. Every method is side-explicit; nothing here touches I/O itself. */
export interface DeltaPorts {
    /** Text of the given paths on one side (C1 resolution: extract cache / git / pre-images; after = working tree). */
    texts(side: 'before' | 'after', paths: readonly string[]): Promise<Map<string, SideText | UnresolvedFile>>;
    /** Facts and findings of one side. `before` is the after graph with the changed files swapped to their before extracts. */
    facts(side: 'before' | 'after'): Promise<SideFacts>;
    /** 90-day churn per file (commits touching it); empty map when unknown (blast radius uses 0). */
    churn(paths: readonly string[]): Promise<Map<string, number>>;
    /** Past blast-radius scores of this repo, for the percentile bands (C10). */
    pastScores(): Promise<number[]>;
    /** Optional analyzers (L3). A missing port or a failed run makes the rules that need it `not_measured`, never zero. */
    analyze?(tool: string, side: 'before' | 'after', scope: readonly string[]): Promise<{ measuredBy: MeasuredBy; findings: SideFacts['findings'] }>;
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
    /** Repo overrides from `.builderforce/delta.json` merged over the built-in registries. */
    registries: DeltaRegistries;
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
     * one side or failure makes this rule's kind `not_comparable`. Default `[id]`. Extractor reasons gate
     * only rules that read `structure` or `body`; scope/repo/branch/truncation gate every rule.
     */
    producers?: readonly string[];
    /**
     * C2: `impact` (default) rules read only the changed files. `global` rules read the whole tree
     * (`SideFacts.findings`); their `changed`/`persisting` findings are kept only when they touch the
     * impact set, while `introduced`/`resolved` are kept anywhere.
     */
    scope?: 'impact' | 'global';
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

/** Data registries (C5–C8). Built-in defaults in `registry/`, extended per repo by `.builderforce/delta.json`. */
export interface DeltaRegistries {
    /** Guard names, ranked (higher = stronger), e.g. `{ requireSuperadmin: 40, requireAuth: 10 }`. */
    guards: Readonly<Record<string, number>>;
    /** Module specifiers / call names by capability (`process-exec`, `fs-write`, `network`, `dynamic-code`, `native-addon`, `env-read`). */
    capabilities: Readonly<Record<string, readonly string[]>>;
    /** Weak-crypto patterns (regex sources). */
    weakCrypto: readonly string[];
    /** Awaited I/O call patterns (regex sources) for `io-in-loop`. */
    io: readonly string[];
    /** Suppression markers for `suppression-added`. */
    suppressions: readonly string[];
    /** Matcher strength classes, strongest first. */
    matchers: readonly (readonly string[])[];
    /** Rule ids that block an autonomous run's finalization when introduced or changed (§12.5). */
    blocking: readonly string[];
}

export interface DimensionRegistry {
    dimensions: readonly DimensionId[];
    rules: readonly DeltaRule[];
    metrics: readonly MetricRule[];
    registries: DeltaRegistries;
}
