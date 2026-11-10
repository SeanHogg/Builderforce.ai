/**
 * The view's ONE port: `KnowledgeGraphSource` (PRD 38 §4.6). A host decides only where
 * files come from and where memory is persisted; the view never imports a host adapter.
 *
 * ── THE REVIEW CONFIRM HANDSHAKE ─────────────────────────────────────────────────
 * Review writes memory, so the confirm chip is mandatory (§4.3). The handshake is:
 *
 *   1. The view calls `review(req, ctl)` SYNCHRONOUSLY inside the person's click — a
 *      host whose picker needs a user gesture (`<input webkitdirectory>`) opens it there.
 *   2. The source walks the folder (`planReview`: a walk plus a manifest diff, no reads
 *      of unchanged files) and YIELDS `{ type: 'plan', plan, estimate? }`. The view
 *      renders the chip: files by pack, unchanged files, ≈ model calls (≈ cost when the
 *      estimate carries one).
 *   3. The source then AWAITS `ctl.confirm(plan)`. The view resolves it from the chip:
 *      Confirm → `true`; Cancel → `false`; *Re-review all* → `false`, after which the
 *      view starts a NEW review with `force: true` (the manifest is ignored, so every
 *      file is planned as changed).
 *   4. `false` ⇒ the source yields `{ type: 'cancelled' }` and returns, having written
 *      nothing. `true` ⇒ it runs `reviewDirectory`, yielding `{ type: 'progress' }` per
 *      step, then `{ type: 'done', report }`.
 *      A run that fails THROWS: any Error works; a `ReviewFailure` (`reviewFailure.ts`) also
 *      carries the host's stack / build / folder, which the failed chip's *Copy details* reports.
 *   5. `ctl.signal` aborts a running review (Stop). Facts already written stay; each
 *      file is written whole or not at all.
 *
 * A source that cannot review omits `review`; the view then offers no review control.
 */

import type { ReactNode } from 'react';
import type {
    CallSite, Finding, KnowledgeGraph, ReviewPlan, ReviewProgress as MemoryReviewProgress, ReviewReport,
} from '@seanhogg/builderforce-memory/knowledge';

import type { AppliedFix, FixCheckResult, FixCheckUpdate, FixPreview, FixStepRequest, RecordedRun } from './fixPorts';
import type { LoadTrace } from './loadTraceTypes';
import type { AgentRunsPort, ReplicaState, ReviewRunsPort } from './runPorts';

// The run ports live in `runPorts.ts`; every name stays importable from here.
export type {
    AgentRunEvidence, AgentRunFile, AgentRunFinding, AgentRunReport, AgentRunSeverity, AgentRunsPort, AgentRunSummary, AgentRunTurn, AgentRunTurnKind,
    ReplicaState, ReviewRunsPort, ReviewRunSummary, StoredReviewRun,
} from './runPorts';

export type LensId =
    | 'structure' | 'partitions' | 'duplication' | 'claims' | 'links' | 'unused' | 'knowledge' | 'live' | 'compare';

/**
 * How the graph is drawn: the transit map (`transit`, flat or as 2.5D towers and pipes: a look
 * toggle inside the camera, not a camera of its own), the 2D graph, the WebGL 3D view (`3d`, the id
 * the old tower had, so a stored or deep-linked `3d` still opens the WebGL view), the folder mind
 * map, or the accessible list. A new camera is a value here plus a row in `surface/cameras.tsx`.
 */
export type ViewMode = 'transit' | 'system' | 'graph' | '3d' | 'map' | 'heat' | '4plus1' | 'style' | 'features' | 'sequence' | 'list';

/** What a screenshot pinpointed: the AI read the image, the host matched the strings deterministically. */
export type PinpointResult = {
    description: string;
    anchors: { text: string; provenance: 'vision' }[];
    matches: { ref: string; why: string; provenance: 'exact' | 'catalog' | 'import' }[];
};

/**
 * `load`'s answer when the host holds no review of the root on THIS machine (PRD 41 A7): the view says
 * "Not reviewed on this machine" and offers Review, plus the server's copy when `canSeed`.
 */
export type NotReviewedHere = { notReviewedHere: { canSeed: boolean } };

export const isNotReviewedHere = (value: unknown): value is NotReviewedHere =>
    typeof value === 'object' && value !== null && 'notReviewedHere' in value;

/** Where the host's sync of a reviewed root stands: local against server, what was skipped, which sources exist. */
export type SyncStatus = {
    /** `edges` absent ⇒ not measured (a linked folder); `truncated` ⇒ the graph was cut short. */
    local: { files: number; edges?: number; docs: number; truncated?: boolean };
    server?: { files: number; edges?: number; docs: number; truncated?: boolean };
    /** The replica queue: what is still to send to the project. Absent ⇒ the root is not linked. */
    replica?: ReplicaState;
    /** Absent ⇒ unknown: no review recorded what it skipped (never read as "nothing skipped"). `bytes` absent ⇒ not measured. */
    skipped?: { path: string; bytes?: number; reason: string }[];
    sources: { id: 'code' | 'docs' | 'coverage' | 'usage' | 'traces' | 'openapi' | 'history' | 'owners'; state: 'collected' | 'estimated' | 'absent'; note?: string }[];
};

export interface KnowledgeScopeSummary {
    rootId: string;
    title: string;
    packs: string[];
    lastReviewedAt?: string;
    /** The root has no local tree on this machine: the host draws it from the server's graph, read-only. */
    serverOnly?: boolean;
    readOnly?: boolean;
}

export interface KnowledgeSearchHit {
    ref: string;
    score: number;
    tier: string;
}

/** A place the host can review: its workspace, a folder upload, a connected drive… */
export interface ReviewTarget {
    id: string;
    kind: 'workspace' | 'upload' | 'drive' | 'folder';
    /** The host's own words for it (an account, a folder). The view supplies the kind's label. */
    title?: string;
}

export interface ReviewRequest {
    /** Re-review a known root. */
    rootId?: string;
    /** Review this target (from `targets()`). */
    target?: string;
    /** Let the host pick the directory (its default picker). */
    pick?: boolean;
    /** Ignore the manifest: plan every file as changed (*Re-review all*). */
    force?: boolean;
    /** "Use the server's copy": a local review that reads the project's extracted output first, so unchanged files cost no model call. */
    seed?: boolean;
    /** Retry (PRD 41 A8): these files failed before; the host owes them a review again, then the normal plan and confirm. */
    retry?: string[];
}

export interface ReviewEstimate {
    modelCalls: number;
    /** ≈ cost in USD, when the host can price the judgement pass. */
    costUsd?: number;
    /** The judgement pass runs on the person's own local model: no cost to show, only a note. */
    local?: boolean;
}

/** A file the review did not store, and why (`bytes` absent ⇒ not measured). */
export type SkippedFile = { path: string; bytes?: number; reason: string };

export type KnowledgeReviewEvent =
    | { type: 'plan'; plan: ReviewPlan; estimate?: ReviewEstimate }
    | { type: 'progress'; progress: MemoryReviewProgress }
    | { type: 'done'; rootId: string; report: ReviewReport; skipped?: SkippedFile[] }
    | { type: 'cancelled' };

export interface ReviewControl {
    /** Resolves when the person answers the confirm chip. `false` writes nothing. */
    confirm(plan: ReviewPlan, estimate?: ReviewEstimate): Promise<boolean>;
    signal: AbortSignal;
}

/** What a person may do to one stored fact. Absent when they may do nothing. */
export interface FactActions {
    /** Author or project admin only (PRD 38 §8.3); also removes the fact's relations. */
    delete?(): Promise<void>;
}

export interface KnowledgeGraphSource {
    scopes(): Promise<KnowledgeScopeSummary[]>;
    load(rootId: string, opts?: { focus?: string[]; maxNodes?: number }): Promise<KnowledgeGraph | NotReviewedHere | null>;
    /** Where this host can review. Absent or empty ⇒ `review({ pick: true })` only. */
    targets?(): Promise<ReviewTarget[]>;
    /** plan → confirm → run. Call it synchronously inside the user gesture (see the header). */
    review?(req: ReviewRequest, ctl: ReviewControl): AsyncIterable<KnowledgeReviewEvent>;
    /** The review as a watchable run (PRD 41 A8). Absent ⇒ no Run panel. (A sibling of `review`, which is the plan/confirm/run function.) */
    runs?: ReviewRunsPort;
    /** Recorded agent runs and their findings (PRD 46). Absent ⇒ no Agent runs drawer. */
    agentRuns?: AgentRunsPort;
    search?(rootId: string, q: string): Promise<KnowledgeSearchHit[]>;
    subscribeLive?(rootId: string, cb: (g: KnowledgeGraph) => void): () => void;
    rememberFact?(fact: { content: string; ref: string; rootId: string }): Promise<void>;
    /** The actions this viewer has on a fact node; `undefined` when they have none. */
    factActions?(ref: string): Promise<FactActions | undefined>;
    /** The graph a Compare lens reads as "before", when the host keeps one (web: the
     *  root's previous review, `GET …/knowledge-graph?at=<previousDigest>`). */
    baseline?(rootId: string): Promise<KnowledgeBaseline | null>;
    /**
     * A source that already HOLDS its graph (a tool result, an analysis report): the view
     * paints it on the first render and never loads. `scopes`/`load` still answer for it.
     */
    snapshot?: KnowledgeSnapshot;
    /**
     * The scopes and the graph this host showed last time, painted on the first frame while the fresh
     * read runs. Absent ⇒ the view starts empty. Must be fast (a local read) and never throw. The HOST
     * remembers on its own after each successful full `load` it serves.
     */
    lastSeen?(): Promise<{ scopes: KnowledgeScopeSummary[]; rootId: string; graph: KnowledgeGraph } | null>;
    /** Where a finding was seen: line ranges and an excerpt, when the host knows them. */
    evidence?(finding: Finding, side: EvidenceSide): FindingEvidence[];
    /** Finds the code behind a screenshot (vision read, then deterministic matches). Absent ⇒ no pinpoint input. */
    pinpoint?(image: Blob, rootId: string): Promise<PinpointResult>;
    /** The commits of the root, for the time slider and the changed set. Absent ⇒ no slider. */
    history?(rootId: string): Promise<{ commits: Commit[] }>;
    /**
     * Folder actions on a review root (PRD 41 A9). `exclude` appends the folder to the root's `.builderforce/ignore` and nothing else;
     * the view then starts the normal plan, estimate, confirm Re-review itself. A refusal rejects with a message already in the person's
     * language. Absent ⇒ the stray-copy card is not drawn.
     */
    folders?: { exclude(rootId: string, path: string): Promise<void> };
    /** Local against server counts, skipped files and data sources. Absent ⇒ no Sync panel. */
    syncStatus?(rootId: string): Promise<SyncStatus>;
    /** Retry upload: forget the root's recorded upload failures and send its queue now. Present only on a host that has a replica to pump (any host with a replica: an editor, the web, Rovr); absent ⇒ no Retry. */
    retrySync?(rootId: string): Promise<void>;
    /** Where this host builds the graph it hands `load`: its own store (`local`, an editor: PRD 41 A7) or the platform (`server`). Named in the copied diagnostics; a server map in an editor is a defect they flag. Absent ⇒ not said. */
    mapSource?: 'local' | 'server';
    /** A deterministic codemod for a finding (unused-export, unused-file). Absent ⇒ Resolve prompts the agent. */
    applyFix?(finding: Finding): Promise<AppliedFix>;
    /**
     * The finding kinds `applyFix` handles beyond the builtin codemods (`surface/codemods.ts`).
     * Absent ⇒ only the builtin rows. A kind not listed here is sent to the agent.
     */
    applyFixKinds?: readonly string[];
    /** Runs the four checks of a fix (`FIX_CHECK_IDS`), reporting each as it settles. Absent ⇒ the step goes to the agent. */
    runFixChecks?(req: FixStepRequest, onUpdate: (update: FixCheckUpdate) => void): Promise<FixCheckResult[]>;
    /** What a fix would change, before it is applied (files, and lines when the host can tell). Absent ⇒ the preview lists the finding's files. */
    previewFix?(finding: Finding): Promise<FixPreview | null>;
    /** Records a finding as resolved. Absent ⇒ the step goes to the agent. */
    markResolved?(finding: Finding): Promise<void>;
    /** Reverts an applied fix. Absent ⇒ the step goes to the agent. */
    undoFix?(req: FixStepRequest): Promise<void>;
    /** The values recorded along a path's stops (arguments, returns, payload sizes) and argument presets. Absent ⇒ Simulate edits nothing. */
    recordedValues?(rootId: string, stopIds: string[]): Promise<RecordedRun | null>;
    /**
     * Performs one HTTP request for the API drawer's sandbox (*Try it · Send*). The HOST performs it (an
     * editor has no webview CORS problem) and enforces WHERE it may go: it rejects a request outside
     * localhost and its configured dev origins, with an Error whose message the drawer shows. Absent ⇒ the
     * drawer offers no Send (a web host without a safe server-side proxy), only copy-as-curl.
     */
    tryRequest?(req: TryRequest): Promise<TryResponse>;
    /**
     * The definitions (classes, functions, methods) in some files of the root, read when the map goes inside a
     * package: the stored graph holds files only, so symbols are loaded lazily and never stored. The view asks
     * for at most 200 file refs at a time (`SYMBOL_FILES`). Absent ⇒ a host without file contents (the web): the
     * map's levels below a package show files and say so.
     */
    symbolsOf?(rootId: string, fileRefs: string[]): Promise<SymbolRecord[]>;
    /** The host's timings of the calls the first paint waits on, and the phase a running load is in. Absent ⇒ the view's own timeline only. */
    loadTrace?(): Promise<LoadTrace>;
}

/** One definition. `ref` names it (`<file ref>#<name>`); `parent` is its file's ref, or its class's ref for a member. */
export interface SymbolRecord {
    ref: string;
    name: string;
    kind: 'class' | 'function' | 'method' | 'interface' | 'type' | 'enum' | 'const' | 'struct' | 'trait' | 'module' | (string & {});
    parent: string;
    /** 1-based. */
    line: number;
    exported: boolean;
    /**
     * The symbol-level edges that START here (PRD 43 P0b; the VS Code host's `KnowledgeSymbolRelation`): `kind` is one of
     * memory's `SYMBOL_EDGE_KINDS`, `to` a ref (exact, or `<file ref>#<name>` without `@line`, or an external), `sites`
     * every call site of a `calls` edge. Absent when the host sends none.
     */
    relations?: { kind: string; to: string; sites?: CallSite[] }[];
}

/** One sandbox request. `url` is absolute: the base URL the person typed plus the route. */
export interface TryRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
}

/** What came back. `body` is text (the host caps its size); `ms` is the round trip. */
export interface TryResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
    ms: number;
    /** The host stopped reading at its size cap. */
    truncated?: boolean;
}

/** One commit of the root: the time slider's dot, the changed set (`refs`) and the Sync delta feed's row. THE one commit type. */
export interface Commit {
    sha: string;
    title: string;
    at: string;
    /** The node refs the commit touched. */
    refs: string[];
    /** Who made it, when the host knows. */
    author?: string;
}

/** Compare's "before". */
export interface KnowledgeBaseline {
    graph: KnowledgeGraph;
    /**
     * `false` ⇒ before and after cannot be measured against each other (an analyzer failed
     * or changed on one side): Compare says so instead of reporting a missing finding as
     * resolved. Default true.
     */
    comparable?: boolean;
    /** Why not (memory's `comparable()` reason codes, PRD 41 §C9): Compare shows each, localized. */
    reasons?: readonly string[];
}

export interface KnowledgeSnapshot {
    graph: KnowledgeGraph;
    title?: string;
    baseline?: KnowledgeBaseline | null;
}

/** Which graph a finding came from: the current one, or Compare's "before". */
export type EvidenceSide = 'current' | 'baseline';

/** A line range in a source. `openable: false` ⇒ the host cannot open it (an old revision
 *  it no longer has); `href` is then the fallback link, when there is one. */
export interface SourceLocation {
    path: string;
    startLine: number;
    endLine: number;
    /** The revision the range belongs to, when it is not the working tree. */
    revision?: string;
    openable?: boolean;
    href?: string;
}

export interface FindingEvidence {
    /** The item's own name (a symbol, a dependency). */
    label?: string;
    locations: SourceLocation[];
    excerpt?: string;
}

/** The host's side panel (web: SlideOutPanel). Absent ⇒ the package's own sheet. */
export interface KnowledgePanelRenderProps {
    open: boolean;
    title: string;
    onClose(): void;
    children: ReactNode;
}

export type KnowledgePanelRenderer = (props: KnowledgePanelRenderProps) => ReactNode;

/** The host's destructive confirmation (web: `useConfirm`). Absent ⇒ an inline two-step. */
export type KnowledgeConfirm = (message: string) => Promise<boolean>;
